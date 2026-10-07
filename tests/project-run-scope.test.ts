/**
 * 模块职责：回归验证模块，围绕 `project-run-scope` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-run-scope`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: domain recovery validates the original full task binding before retrying its owned cleanup closure; identities and inherited intents survive manager reload without persisting payload bodies.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Machines } from '../server/machines.ts';
import type { Project } from '../server/workspaces.ts';
import { AppError } from '../server/model.ts';
import { ProjectRunScopes } from '../server/project-run-scope.ts';
import { ExecutionScope } from '../server/execution-scope.ts';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { vmLifetime } from '../server/vm-lifetime.ts';
import { projectIdentitySchema, projectIdentityRunSchema, type ProjectIdentitySshDaemon,
  type ProjectIdentityRun } from '../server/project-identity.ts';
import { OwnedForwardAgent, type SshAgentContext } from '../server/ssh-agent-scope.ts';
import { OwnedGpgForward } from '../server/gpg-agent-host.ts';
import { gpgAgentHomePath, type GpgAgentContext } from '../server/gpg-agent-scope.ts';
import { syntheticGpgHostSnapshot } from './gpg-agent-fixture.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-run-scope-'));
after(() => rm(root, { recursive: true, force: true }));

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: agentCleanup: (context: SshAgentContext) => Promise<void>; gpgCleanup: (context: GpgAgentContext) => Promise<void>。
 * 结果：返回受控对象，公开字段包括 `scopes, machines, core, identity, owner, run, project, vmId, file`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `scopes, machines, core, identity, owner, run, project, vmId, file`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `randomUUID`, `projectIdentitySchema.parse`.
 */
async function fixture(agentCleanup?: /**
 * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
 * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
 * 输入 / Inputs: context: SshAgentContext。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(context: SshAgentContext) => Promise<void>,
  gpgCleanup?: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: context: GpgAgentContext。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (context: GpgAgentContext) => Promise<void>) {
  const directory = await mkdtemp(join(root, 'owned-')), vmId = randomUUID(), identityId = randomUUID();
  const identity = projectIdentitySchema.parse({ version: 1, phase: 'active', registryId: randomUUID(),
    projectId: 'default', identityId, revision: 1, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
    uid: 20000, gid: 20000, home: '/var/lib/sakura-project-homes/' + identityId,
    directory: '/workspace/owned', directoryDevice: '1', directoryInode: '2', homeDevice: '1', homeInode: '3', networkIsolation: 'host' });
  let actual = { ...identity }, absent = true, missing = false, unknown = false, cleanupFail = false, migration = false;
  let directoryLatch: unknown = null;
  const bootId = randomUUID(), owner = { kind: 'task' as const, runId: randomUUID(), bootId };
  let currentBoot: string = bootId;
  const run = projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'inherit-current',
    registryId: identity.registryId, identityId, projectId: 'default', runId: owner.runId, revision: 1,
    bootId, build: 'a'.repeat(64), networkDevice: '4', networkInode: '5', cgroupDevice: '6', cgroupInode: '7',
    cgroupName: 'sakura-task-' + owner.runId, namespace: '' });
  const calls: string[] = [], expected: unknown[] = [], confirmCommands: string[] = [], instance = {}, locks = new Machines({} as never, fakeVmNetwork);
  const machines = {
    live: new Map([[vmId, instance]]),
    locked: locks.locked.bind(locks),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `command.includes`, `JSON.stringify`, `command.trim().endsWith`, `command.trim`.
     * 检查边界 / Checked boundaries: `assert.ok(!command.includes('private-frame-value'))`.
     */
    exec: async (_id: string, command: string) => {
      if (command.includes('/var/lib/sakura/project-directory-migrations/'))
        return { code: 0, stderr: '', stdout: JSON.stringify(directoryLatch) };
      if (command.trim().endsWith('/proc/sys/kernel/random/boot_id'))
        return { code: 0, stderr: '', stdout: currentBoot };
      assert.ok(!command.includes('private-frame-value')); calls.push('confirm'); confirmCommands.push(command);
      return { code: absent ? 0 : 1, stderr: absent ? '' : 'scope exists',
        stdout: JSON.stringify({ bootId: currentBoot, absent: true }) };
    },
  } as unknown as Machines;
  const core = {
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: _vm: string; _binding: unknown; prior: unknown。
     * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
     * 失败 / Failure: `new AppError('migration', 409, 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `calls.push`, `expected.push`.
     */
    ensure: async (_vm: string, _binding: unknown, prior: unknown) => {
      calls.push('ensure'); expected.push(prior);
      if (migration) throw new AppError('migration', 409, 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED');
      return { ...actual };
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
     * 协作入口 / Collaborators: `calls.push`.
     */
    inspect: async (): Promise<typeof identity | null> => { calls.push('inspect'); return { ...actual }; },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _vm: string; old: typeof identity; next: { directory: string; networkIsolation: 'host' | 'private' }。
     * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
     * 状态影响 / State effects: `actual`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `calls.push`.
     */
    rebind: async (_vm: string, old: typeof identity, next: { directory: string; networkIsolation: 'host' | 'private' }) => {
      calls.push('rebind'); actual = { ...old, ...next, revision: old.revision + 1, directoryInode: '99' }; return { ...actual };
    },
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: _identity: unknown; execution: { command: string }; options: { runId: string }。
     * 结果：返回受控对象，公开字段包括 `command, input, sha256, runId`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `command, input, sha256, runId`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `calls.push`, `Buffer.from`, `createHash('sha256').update(input).digest`, `createHash('sha256').update`.
     */
    inheritedInput: async (_identity: unknown, execution: { command: string }, options: { runId: string }) => {
      calls.push('payload'); const input = Buffer.from(execution.command);
      return { command: '/fixed/launch --payload ' + createHash('sha256').update(input).digest('hex'), input,
        sha256: createHash('sha256').update(input).digest('hex'), runId: options.runId };
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _identity: typeof identity; runId: string; environment: Record<string, string> = {}。
     * 结果：返回受控对象，公开字段包括 `command, input, sha256, build, runId`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `command, input, sha256, build, runId`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `calls.push`, `Buffer.from`, `JSON.stringify`, `createHash('sha256').update(input).digest`.
     */
    sshSnapshotInput: async (_identity: typeof identity, runId: string, environment: Record<string, string> = {}) => {
      calls.push('ssh-snapshot'); const input = Buffer.from(JSON.stringify(environment));
      const sha256 = createHash('sha256').update(input).digest('hex');
      return { command: '/fixed/controller --ssh-snapshot ' + sha256, input, sha256, build: run.build, runId };
    },
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: _vm: string; _identity: typeof identity; options: { runId: string; snapshotSha256: string; daemon: ProjectIdentityS…。
     * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
     * 协作入口 / Collaborators: `calls.push`, `Object.assign`.
     */
    prepareSsh: async (_vm: string, _identity: typeof identity,
      options: { runId: string; snapshotSha256: string; daemon: ProjectIdentitySshDaemon }) => {
      calls.push('ssh-prepare');
      Object.assign(run, { mode: 'inherit-current', runId: options.runId,
        bootId: options.daemon.bootId, cgroupName: options.daemon.cgroupName });
      return { ...run };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
     * 失败 / Failure: `new AppError('lost reply', 502, 'PROJECT_IDENTITY_CONTROL_FAILED')`; `new AppError('absent', 409, 'PROJECT_IDENTITY_RECORD_ABSENT')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `calls.push`.
     */
    run: async () => {
      calls.push('run');
      if (unknown) throw new AppError('lost reply', 502, 'PROJECT_IDENTITY_CONTROL_FAILED');
      if (missing) throw new AppError('absent', 409, 'PROJECT_IDENTITY_RECORD_ABSENT');
      return { ...run };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
     * 协作入口 / Collaborators: `calls.push`.
     */
    runReadonly: async () => { calls.push('run-readonly'); return { ...run }; },
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: _vm: string; _identity: unknown; options: { runId?: string }。
     * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
     * 协作入口 / Collaborators: `calls.push`, `Object.assign`.
     */
    prepare: async (_vm: string, _identity: unknown, options: { runId?: string }) => {
      calls.push('terminal-prepare');
      Object.assign(run, { mode: 'independent', runId: options.runId, cgroupName: 'sakura-identity-' + options.runId });
      return { ...run };
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `calls.push`.
     */
    retireTerminal: async () => { calls.push('terminal-retire'); },
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `phase`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `phase`; the actual branch determines its shape.
     * 状态影响 / State effects: `run.phase`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new AppError('not confirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `calls.push`.
     */
    stop: async () => {
      calls.push('stop');
      if (cleanupFail) throw new AppError('not confirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      if (run.mode === 'independent') run.phase = 'closed';
      return { ...run, phase: 'closed' as const };
    },
  };
  const options = { identities: core, rootDirectory: directory,
    ...(agentCleanup ? { agentScopes: { /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: _vm: string; context: SshAgentContext。
     * 结果：返回分支计算值（`agentCleanup(context)`），以 Promise 交付。
     * Result: Return the branch-computed value (`agentCleanup(context)`) through a Promise.
     * 协作入口 / Collaborators: `agentCleanup`.
     */
    cleanup: async (_vm: string, context: SshAgentContext) => agentCleanup(context) } } : {}),
    ...(gpgCleanup ? { gpgScopes: { /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: _vm: string; context: GpgAgentContext。
     * 结果：返回分支计算值（`gpgCleanup(context)`），以 Promise 交付。
     * Result: Return the branch-computed value (`gpgCleanup(context)`) through a Promise.
     * 协作入口 / Collaborators: `gpgCleanup`.
     */
    cleanup: async (_vm: string, context: GpgAgentContext) => gpgCleanup(context) } } : {}) };
  const scopes = new ProjectRunScopes(machines, options);
  const project = { directory: identity.directory, networkIsolation: 'host' } as Project;
  const file = join(directory, 'project-identities', 'default.json');
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`JSON.parse(await readFile(file, 'utf8'))`），以 Promise 交付。
   * Result: Return the branch-computed value (`JSON.parse(await readFile(file, 'utf8'))`) through a Promise.
   * 协作入口 / Collaborators: `JSON.parse`, `readFile`.
   */
  const view = async () => JSON.parse(await readFile(file, 'utf8'));
  return { scopes, machines, core, identity, owner, run, project, vmId, file, view, calls, expected, confirmCommands,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `absent`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setAbsent: (value: boolean) => { absent = value; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `missing`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setMissing: (value: boolean) => { missing = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `unknown`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setUnknown: (value: boolean) => { unknown = value; }, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `cleanupFail`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setCleanupFail: (value: boolean) => { cleanupFail = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `migration`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setMigration: (value: boolean) => { migration = value; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: typeof identity。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `actual`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setIdentity: (value: typeof identity) => { actual = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: unknown。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `directoryLatch`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setDirectoryLatch: (value: unknown) => { directoryLatch = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `currentBoot`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setBoot: (value: string) => { currentBoot = value; },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`new ProjectRunScopes(machines, options)`）。
     * Result: Return the branch-computed value (`new ProjectRunScopes(machines, options)`).
     */
    reopened: () => new ProjectRunScopes(machines, options) };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: domain recovery validates the original full task binding before retrying its owned cleanup closure
 * 状态影响 / State effects: `f.core.run`, `changed.runs[0].sha256`, `confirmed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `ExecutionScope.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(ExecutionScope.run({ machines: f.machines, vmId: f.vmId, projectId: 'default', signal: new AbortController().signal…`; `assert.equal(governor.snapshot().resources[0].state, 'cleanup-pending')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('domain recovery validates the original full task binding before retrying its owned cleanup closure', async () => {
  const f = await fixture(), governor = new HostRuntime({ budgets: { execution: { capacity: 1 } } });
  const failure = new AppError('original cgroup receipt still owned', 503, 'GUEST_TASK_CLEANUP_FAILED');
  let confirmed = false, calls = 0, runId = '';
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: domain recovery validates the original full task binding before retrying its owned cleanup closure
   * 失败 / Failure: `new AppError('unissued', 409, 'PROJECT_IDENTITY_RECORD_ABSENT')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw new AppError('unissued', 409, 'PROJECT_IDENTITY_RECORD_ABSENT'); };
  await assert.rejects(ExecutionScope.run({ machines: f.machines, vmId: f.vmId, projectId: 'default',
    signal: new AbortController().signal, governor }, async scope => {
    const admission = await f.scopes.admitTask(f.vmId, f.project, { command: 'owned-frame' }, scope.signal);
    runId = admission.payload.runId;
    const cleanup = scope.deferCleanup(async () => {
      calls++;
      if (!confirmed) throw failure;
      // This callback reacquires the identity lock; recovery must not hold that lock while calling it.
      await f.scopes.closeAfterScopeStopped(f.vmId, 'default', runId);
    });
    try { await cleanup(); } finally { admission.release(); }
  }), error => error === failure);
  assert.equal(governor.snapshot().resources[0].state, 'cleanup-pending');
  const original = await f.view(), changed = structuredClone(original);
  changed.runs[0].sha256 = 'f'.repeat(64);
  await writeFile(f.file, JSON.stringify(changed));
  confirmed = true;
  await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'EXECUTION_CLEANUP_PENDING' });
  assert.equal(calls, 1, 'a changed journal cannot exercise another operation cleanup capability');
  await writeFile(f.file, JSON.stringify(original));
  await f.reopened().recoverStoppedTasks(f.vmId, 'default');
  assert.equal(calls, 2);
  assert.equal(governor.snapshot().resources.length, 0);
  assert.equal(vmLifetime(f.vmId, f.machines.live.get(f.vmId)!).active, 0);
  await f.reopened().recoverStoppedTasks(f.vmId, 'default'); assert.equal(calls, 2);
  governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: identities and inherited intents survive manager reload without persisting payload bodies
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `assert.equal`, `payload.input.toString`.
 * 检查边界 / Checked boundaries: `assert.equal(payload.input.toString(), 'private-frame-value')`; `assert.ok(!payload.command.includes('private-frame-value'))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('identities and inherited intents survive manager reload without persisting payload bodies', async () => {
  const f = await fixture();
  const payload = await f.scopes.inherited(f.vmId, f.project,
    { command: 'private-frame-value', environment: { TOKEN: 'private-environment' } }, f.owner);
  assert.equal(payload.input.toString(), 'private-frame-value');
  assert.ok(!payload.command.includes('private-frame-value'));
  const text = await readFile(f.file, 'utf8');
  assert.ok(!text.includes('private-frame-value') && !text.includes('private-environment'));
  assert.deepEqual((await f.view()).runs[0].identity, f.identity);
  assert.equal(await f.reopened().hasRun(f.vmId, 'default', f.owner.runId), true);
  await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  await f.reopened().identity(f.vmId, f.project);
  assert.deepEqual(f.expected[1], { registryId: f.identity.registryId, identityId: f.identity.identityId, revision: 1 });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: protocol task own intent callback runs before lower host intent becomes durable
 * 协作入口 / Collaborators: `fixture`, `f.scopes.admitTask`, `assert.equal`, `(await f.view()).runs.find`.
 * 检查边界 / Checked boundaries: `assert.equal(callbacks, 1)`; `assert.equal(admission.payload.runId, originalId)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('protocol task own intent callback runs before lower host intent becomes durable', async () => {
  const f = await fixture(); let originalId = '', callbacks = 0;
  const admission = await f.scopes.admitTask(f.vmId, f.project, { command: 'private-protocol-body', stdin: 'session' },
    new AbortController().signal, { /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: { identity, owner, sha256 }。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: protocol task own intent callback runs before lower host intent becomes durable
     * 状态影响 / State effects: `originalId`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.equal`, `assert.deepEqual`, `assert.match`, `(await f.view()).runs.some`.
     * 检查边界 / Checked boundaries: `assert.equal(owner.kind, 'task')`; `assert.equal(owner.bootId, f.owner.bootId)`.
     */
    beforeIntent: async ({ identity, owner, sha256 }) => {
      ++callbacks; originalId = owner.runId;
      assert.equal(owner.kind, 'task'); assert.equal(owner.bootId, f.owner.bootId); assert.deepEqual(identity, f.identity);
      assert.match(sha256, /^[a-f0-9]{64}$/);
      assert.equal((await f.view()).runs.some((entry: any) => entry.runId === owner.runId), false);
    } });
  try { assert.equal(callbacks, 1); assert.equal(admission.payload.runId, originalId);
    assert.equal((await f.view()).runs.find((entry: any) => entry.runId === originalId).phase, 'intent'); }
  finally { admission.release(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed protocol own intent never creates a lower executable host task intent
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.scopes.admitTask`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'not-executed', stdin: 'session' }, new AbortController().signal, …`; `assert.equal((await f.view()).runs.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('failed protocol own intent never creates a lower executable host task intent', async () => {
  const f = await fixture();
  await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'not-executed', stdin: 'session' },
    new AbortController().signal, { /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: failed protocol own intent never creates a lower executable host task intent
     * 失败 / Failure: `new Error('own intent fsync lost')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    beforeIntent: async () => { throw new Error('own intent fsync lost'); } }), /own intent fsync lost/);
  assert.equal((await f.view()).runs.length, 0); assert.equal(f.calls.includes('stop'), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: readonly task API requires pre-pinned full receipt and returns exact identity, original domain and transport digest
 * 状态影响 / State effects: `f.calls.length`, `f.core.runReadonly`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `readFile`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().readonlyTask(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_RUN_STALE' })`; `assert.equal(f.calls.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('readonly task API requires pre-pinned full receipt and returns exact identity, original domain and transport digest', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'stream' }, f.owner);
  const intent = await readFile(f.file, 'utf8'); f.calls.length = 0;
  await assert.rejects(f.reopened().readonlyTask(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_RUN_STALE' });
  assert.equal(f.calls.length, 0); assert.equal(await readFile(f.file, 'utf8'), intent);
  await f.scopes.active(f.vmId, 'default', f.owner.runId); const active = await readFile(f.file, 'utf8'); f.calls.length = 0;
  const checked = await f.reopened().readonlyTask(f.vmId, 'default', f.owner.runId);
  assert.deepEqual(checked.identity, f.identity); assert.deepEqual(checked.owner, f.owner); assert.deepEqual(checked.run, f.run);
  assert.equal(checked.sha256, createHash('sha256').update('stream').digest('hex'));
  assert.deepEqual(f.calls, ['run-readonly']); assert.equal(await readFile(f.file, 'utf8'), active);
  f.core.runReadonly = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...f.run, cgroupInode: '999' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...f.run, cgroupInode: '999' })`) through a Promise.
   * 验证场景 / Scenario: readonly task API requires pre-pinned full receipt and returns exact identity, original domain and transport digest
   */
  async () => ({ ...f.run, cgroupInode: '999' });
  await assert.rejects(f.reopened().readonlyTask(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(await readFile(f.file, 'utf8'), active);
});

for (const field of ['identity', 'owner', 'sha256', 'live'] as const) /**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 状态影响 / State effects: `f.core.runReadonly`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `f.scopes.active`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().readonlyTask(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' })`; `assert.equal(row.phase, 'active')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('readonly task refuses concurrent original ' + field + ' replacement without advancing host phase', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'stream' }, f.owner);
  await f.scopes.active(f.vmId, 'default', f.owner.runId);
  f.core.runReadonly = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
   * 状态影响 / State effects: `journal.runs[0].identity.homeInode`, `journal.runs[0].owner.bootId`, `journal.runs[0].run.bootId`, `journal.runs[0].sha256`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `f.machines.live.set`, `f.view`, `randomUUID`, `'f'.repeat`.
   */
  async () => {
    if (field === 'live') f.machines.live.set(f.vmId, {} as never);
    else {
      const journal = await f.view();
      if (field === 'identity') journal.runs[0].identity.homeInode = '999';
      if (field === 'owner') {
        const replacement = randomUUID(); journal.runs[0].owner.bootId = replacement;
        journal.runs[0].run.bootId = replacement;
      }
      if (field === 'sha256') journal.runs[0].sha256 = 'f'.repeat(64);
      await writeFile(f.file, JSON.stringify(journal));
    }
    return { ...f.run };
  };
  await assert.rejects(f.reopened().readonlyTask(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  const row = (await f.view()).runs[0]; assert.equal(row.phase, 'active');
  assert.ok(!f.calls.includes('stop') && !f.calls.includes('confirm'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: task receipt lookup is read only for missing, intent, closed and archived original tickets
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `f.reopened().taskRun`, `f.reopened`.
 * 检查边界 / Checked boundaries: `assert.equal(await f.reopened().taskRun(f.vmId, 'default', randomUUID()), null)`; `assert.equal(f.calls.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('task receipt lookup is read only for missing, intent, closed and archived original tickets', async () => {
  const f = await fixture(); f.calls.length = 0;
  assert.equal(await f.reopened().taskRun(f.vmId, 'default', randomUUID()), null);
  assert.equal(f.calls.length, 0);
  await f.scopes.inherited(f.vmId, f.project, { command: 'stream' }, f.owner);
  f.calls.length = 0; const intent = await readFile(f.file, 'utf8');
  assert.equal((await f.reopened().taskRun(f.vmId, 'default', f.owner.runId))?.phase, 'intent');
  assert.equal(await readFile(f.file, 'utf8'), intent); assert.equal(f.calls.length, 0);
  await f.scopes.active(f.vmId, 'default', f.owner.runId);
  await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  const closed = await readFile(f.file, 'utf8'); f.calls.length = 0;
  assert.equal((await f.reopened().taskRun(f.vmId, 'default', f.owner.runId))?.phase, 'closed');
  assert.equal(await readFile(f.file, 'utf8'), closed); assert.equal(f.calls.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: independent terminal tickets persist across reload and require native stop and resource retirement before closure
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.prepareTerminal`, `assert.equal`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(issued.run.mode, 'independent')`; `assert.deepEqual(await f.reopened().terminalRuns(f.vmId, 'default'), [{ runId: f.owner.runId, terminal, phase: 'active' }])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('independent terminal tickets persist across reload and require native stop and resource retirement before closure', async () => {
  const f = await fixture(), terminal = { name: 'sakura-terminal-default-main', persistent: true };
  const issued = await f.scopes.prepareTerminal(f.vmId, f.project, f.owner.runId, terminal);
  assert.equal(issued.run.mode, 'independent');
  assert.deepEqual(await f.reopened().terminalRuns(f.vmId, 'default'),
    [{ runId: f.owner.runId, terminal, phase: 'active' }]);
  await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  const checked = await f.reopened().terminalRun(f.vmId, 'default', f.owner.runId); assert.deepEqual(checked.run, issued.run);
  f.calls.length = 0;
  await f.reopened().stopTerminal(f.vmId, 'default', f.owner.runId);
  assert.ok(f.calls.indexOf('stop') < f.calls.indexOf('terminal-retire'));
  assert.ok(f.calls.indexOf('terminal-retire') < f.calls.indexOf('confirm'));
  const closed = (await f.view()).runs[0]; assert.equal(closed.phase, 'closed'); assert.equal(closed.run.phase, 'closed');
  await f.reopened().guard(f.vmId, 'default');
  await assert.rejects(f.scopes.prepareTerminal(f.vmId, f.project, f.owner.runId, terminal), { code: 'PROJECT_IDENTITY_RUN_STALE' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: terminal resource cleanup failure retains the original full receipt and retries after native already closed
 * 状态影响 / State effects: `f.core.retireTerminal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.prepareTerminal`, `f.view`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.stopTerminal(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED', status: 503 })`; `assert.deepEqual((await f.view()).runs[0], original)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('terminal resource cleanup failure retains the original full receipt and retries after native already closed', async () => {
  const f = await fixture();
  await f.scopes.prepareTerminal(f.vmId, f.project, f.owner.runId, { name: 'sakura-terminal-default-main', persistent: true });
  const original = (await f.view()).runs[0];
  f.core.retireTerminal = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: terminal resource cleanup failure retains the original full receipt and retries after native already closed
   * 失败 / Failure: `new AppError('resource changed', 409, 'PROJECT_IDENTITY_TERMINAL_SOCKET_CHANGED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw new AppError('resource changed', 409, 'PROJECT_IDENTITY_TERMINAL_SOCKET_CHANGED'); };
  await assert.rejects(f.scopes.stopTerminal(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED', status: 503 });
  assert.deepEqual((await f.view()).runs[0], original);
  assert.equal(f.run.phase, 'closed');
  await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  f.core.retireTerminal = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: terminal resource cleanup failure retains the original full receipt and retries after native already closed
   * 协作入口 / Collaborators: `f.calls.push`.
   */
  async () => { f.calls.push('terminal-retire'); };
  await f.reopened().stopTerminal(f.vmId, 'default', f.owner.runId);
  assert.equal((await f.view()).runs[0].phase, 'closed');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: VM drain refuses a replaced terminal journal and only the original complete receipt can retire its session
 * 状态影响 / State effects: `changed.runs[0].run.cgroupInode`, `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.prepareTerminal`, `vmLifetime`, `f.machines.live.get`.
 * 检查边界 / Checked boundaries: `assert.rejects(lifetime.barrier(async () => assert.fail('unconfirmed session may not snapshot')), { code: 'EXECUTION_CLEANUP_PENDI…`; `assert.equal(f.calls.includes('stop'), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('VM drain refuses a replaced terminal journal and only the original complete receipt can retire its session', async () => {
  const f = await fixture();
  await f.scopes.prepareTerminal(f.vmId, f.project, f.owner.runId, { name: 'sakura-terminal-default-main', persistent: true });
  const lifetime = vmLifetime(f.vmId, f.machines.live.get(f.vmId)!);
  const original = await f.view(), changed = structuredClone(original);
  changed.runs[0].run.cgroupInode = '999';
  await writeFile(f.file, JSON.stringify(changed)); f.calls.length = 0;
  await assert.rejects(lifetime.barrier(async () => assert.fail('unconfirmed session may not snapshot')),
    { code: 'EXECUTION_CLEANUP_PENDING' });
  assert.equal(f.calls.includes('stop'), false); assert.equal(lifetime.active, 1);
  await assert.rejects(f.scopes.guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  await writeFile(f.file, JSON.stringify(original));
  await f.reopened().stopTerminal(f.vmId, 'default', f.owner.runId);
  assert.equal(lifetime.active, 0);
  await lifetime.barrier(async () => {}); await lifetime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: duplicate terminal labels and foreign owner kinds refuse without issuing or closing another ticket
 * 协作入口 / Collaborators: `fixture`, `f.scopes.prepareTerminal`, `f.calls.filter`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.prepareTerminal(f.vmId, f.project, randomUUID(), terminal), { code: 'PROJECT_IDENTITY_RUN_STALE' })`; `assert.equal(f.calls.filter(call => call === 'terminal-prepare').length, before)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('duplicate terminal labels and foreign owner kinds refuse without issuing or closing another ticket', async () => {
  const f = await fixture(), terminal = { name: 'sakura-terminal-default-main', persistent: true };
  await f.scopes.prepareTerminal(f.vmId, f.project, f.owner.runId, terminal);
  const before = f.calls.filter(call => call === 'terminal-prepare').length;
  await assert.rejects(f.scopes.prepareTerminal(f.vmId, f.project, randomUUID(), terminal), { code: 'PROJECT_IDENTITY_RUN_STALE' });
  assert.equal(f.calls.filter(call => call === 'terminal-prepare').length, before);
  const g = await fixture(); await g.scopes.inherited(g.vmId, g.project, { command: 'fixed' }, g.owner);
  await assert.rejects(g.scopes.stopTerminal(g.vmId, 'default', g.owner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(g.calls.includes('stop'), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: terminal cold-boot recovery retires the original receipt without invoking old native stop
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.prepareTerminal`, `f.view`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.equal(retired.phase, 'closed')`; `assert.deepEqual(retired.run, original.run)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('terminal cold-boot recovery retires the original receipt without invoking old native stop', async () => {
  const f = await fixture();
  await f.scopes.prepareTerminal(f.vmId, f.project, f.owner.runId, { name: 'sakura-terminal-default-main', persistent: true });
  const original = (await f.view()).runs[0], reboot = randomUUID(); f.setBoot(reboot); f.calls.length = 0;
  await f.reopened().retireRebootedTerminals(f.vmId, 'default');
  const retired = (await f.view()).runs[0]; assert.equal(retired.phase, 'closed');
  assert.deepEqual(retired.run, original.run);
  assert.deepEqual(retired.retirement, { reason: 'guest-reboot', bootId: reboot });
  assert.equal(f.calls.includes('stop'), false); assert.equal(f.calls.includes('terminal-retire'), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a fixed reservation can be previewed but cannot execute before directory migration
 * 协作入口 / Collaborators: `fixture`, `f.setMigration`, `f.setIdentity`, `f.scopes.reserve`.
 * 检查边界 / Checked boundaries: `assert.equal(intent.phase, 'intent')`; `assert.rejects(f.scopes.inherited(f.vmId, f.project, { command: 'must-not-run' }, f.owner), { code: 'PROJECT_IDENTITY_DIRECTORY_MI…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a fixed reservation can be previewed but cannot execute before directory migration', async () => {
  const f = await fixture(); f.setMigration(true); f.setIdentity({ ...f.identity, phase: 'intent' });
  const intent = await f.scopes.reserve(f.vmId, f.project);
  assert.equal(intent.phase, 'intent');
  await assert.rejects(f.scopes.inherited(f.vmId, f.project, { command: 'must-not-run' }, f.owner),
    { code: 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED' });
  assert.equal(f.calls.includes('payload'), false);
  assert.equal((await f.view()).runs.length, 0);
  f.setMigration(false); f.setIdentity(f.identity);
  assert.equal((await f.scopes.identity(f.vmId, f.project)).identityId, intent.identityId);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a typed directory refusal and verified absent first binding do not permanently pin an invalid path
 * 状态影响 / State effects: `f.core.inspect`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.setMigration`, `assert.rejects`, `f.scopes.reserve`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.reserve(f.vmId, f.project), { code: 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED' })`; `assert.equal((await f.view()).pending, null)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a typed directory refusal and verified absent first binding do not permanently pin an invalid path', async () => {
  const f = await fixture(); f.setMigration(true);
  f.core.inspect = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`null`），以 Promise 交付。
   * Result: Return the branch-computed value (`null`) through a Promise.
   * 验证场景 / Scenario: a typed directory refusal and verified absent first binding do not permanently pin an invalid path
   */
  async () => null;
  await assert.rejects(f.scopes.reserve(f.vmId, f.project), { code: 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED' });
  assert.equal((await f.view()).pending, null); assert.equal((await f.view()).identity, null);
  const next = { ...f.project, directory: '/srv/projects/existing' };
  f.setMigration(false); f.setIdentity({ ...f.identity, directory: next.directory });
  assert.equal((await f.reopened().identity(f.vmId, next)).directory, next.directory);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: full identity fields remain pinned across reload even when IDs and revision match
 * 协作入口 / Collaborators: `fixture`, `f.scopes.identity`, `f.setIdentity`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().identity(f.vmId, f.project), { code: 'PROJECT_IDENTITY_HOST_CHANGED' })`; `assert.equal((await f.view()).identity.homeInode, '3')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('full identity fields remain pinned across reload even when IDs and revision match', async () => {
  const f = await fixture(); await f.scopes.identity(f.vmId, f.project);
  f.setIdentity({ ...f.identity, homeInode: '999' });
  await assert.rejects(f.reopened().identity(f.vmId, f.project), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal((await f.view()).identity.homeInode, '3');
  await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_BINDING_PENDING' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: live outer domains prevent ticket closure and leave the journal unchanged
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `f.setAbsent`, `readFile`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal(await readFile(f.file, 'utf8'), before)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('live outer domains prevent ticket closure and leave the journal unchanged', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  f.setAbsent(false); const before = await readFile(f.file, 'utf8');
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.calls.includes('run'), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: closure reads the exact guest ticket only after confirming the outer domain stopped
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `f.reopened().closeAfterScopeStopped`, `f.reopened`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(f.calls, ['confirm', 'run', 'confirm', 'stop'])`; `assert.equal(journal.runs[0].phase, 'closed')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('closure reads the exact guest ticket only after confirming the outer domain stopped', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  f.calls.length = 0;
  await f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  assert.deepEqual(f.calls, ['confirm', 'run', 'confirm', 'stop']);
  const journal = await f.view(); assert.equal(journal.runs[0].phase, 'closed');
  assert.equal(journal.runs[0].run.phase, 'closed'); await f.scopes.guard(f.vmId, 'default');
  const count = f.calls.length; await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  assert.equal(f.calls.length, count, 'confirmed retirement is idempotent');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an unknown control failure is never accepted as a ticket that did not start
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `f.setUnknown`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal((await f.view()).runs[0].phase, 'intent')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('an unknown control failure is never accepted as a ticket that did not start', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  f.setUnknown(true);
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal((await f.view()).runs[0].phase, 'intent'); assert.equal(f.calls.includes('stop'), false);
  f.setUnknown(false); f.setMissing(true);
  await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  assert.equal((await f.view()).runs[0].phase, 'closed'); assert.equal((await f.view()).runs[0].run, null);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a lost stop acknowledgement pins the full ticket and cannot later accept RECORD_ABSENT
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `f.setCleanupFail`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal((await f.view()).runs[0].phase, 'active')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a lost stop acknowledgement pins the full ticket and cannot later accept RECORD_ABSENT', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  f.setCleanupFail(true);
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal((await f.view()).runs[0].phase, 'active');
  assert.deepEqual((await f.view()).runs[0].run, f.run);
  f.setMissing(true); f.setCleanupFail(false);
  await assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  f.setMissing(false); await f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  assert.equal((await f.view()).runs[0].phase, 'closed');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a mismatched outer domain or identity ticket cannot be retired
 * 状态影响 / State effects: `f.core.run`, `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `assert.rejects`, `f.scopes.closeAfterScopeStopped`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal((await f.view()).runs[0].phase, 'intent')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a mismatched outer domain or identity ticket cannot be retired', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  const original = f.core.run; f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...f.run, cgroupName: 'sakura-main-' + f.owner.runId })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...f.run, cgroupName: 'sakura-main-' + f.owner.runId })`) through a Promise.
   * 验证场景 / Scenario: a mismatched outer domain or identity ticket cannot be retired
   */
  async () => ({ ...f.run, cgroupName: 'sakura-main-' + f.owner.runId });
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal((await f.view()).runs[0].phase, 'intent'); f.core.run = original;
  f.machines.live.set(f.vmId, {} as never);
  // Replacement before cleanup begins is a current live instance. Subsequent
  // changes during the actual receipt check are what must invalidate cleanup.
  const exec = f.machines.exec; f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: a mismatched outer domain or identity ticket cannot be retired
   * 协作入口 / Collaborators: `exec`, `f.machines.live.set`.
   */
  async (...args) => {
    const result = await exec(...args); f.machines.live.set(f.vmId, {} as never); return result;
  };
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a controller refusal before issuance is typed only after the exact unissued task intent closes
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `f.setMissing`, `f.scopes.closeAfterScopeStopped`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.assertTaskIssued(f.vmId, 'default', f.owner.runId, { code: 1, stdout: '{"ok":false,"code":"DIRECTORY_MIGRA…`; `assert.rejects(f.scopes.assertTaskIssued(f.vmId, 'default', f.owner.runId, { code: 0, stdout: '', stderr: '' }), { code: 'PROJECT_…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a controller refusal before issuance is typed only after the exact unissued task intent closes', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  f.setMissing(true); await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  f.calls.length = 0;
  await assert.rejects(f.scopes.assertTaskIssued(f.vmId, 'default', f.owner.runId,
    { code: 1, stdout: '{"ok":false,"code":"DIRECTORY_MIGRATION_IDENTITY","detail":null}', stderr: '' }),
    { code: 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_IDENTITY', status: 409 });
  await assert.rejects(f.scopes.assertTaskIssued(f.vmId, 'default', f.owner.runId,
    { code: 0, stdout: '', stderr: '' }), { code: 'PROJECT_IDENTITY_LAUNCH_UNCONFIRMED' });
  assert.deepEqual(f.calls, [], 'receipt classification performs no guest mutations or probes');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: issued task output that resembles a controller refusal remains an ordinary user exit
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `assert.rejects`, `f.scopes.assertTaskIssued`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.assertTaskIssued(f.vmId, 'default', f.owner.runId, result), { code: 'PROJECT_IDENTITY_LAUNCH_UNCONFIRMED' …`; `assert.deepEqual(f.calls, [])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('issued task output that resembles a controller refusal remains an ordinary user exit', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  const result = { code: 1, stdout: '{"ok":false,"code":"DIRECTORY_MIGRATION_IDENTITY","detail":null}', stderr: '' };
  await assert.rejects(f.scopes.assertTaskIssued(f.vmId, 'default', f.owner.runId, result),
    { code: 'PROJECT_IDENTITY_LAUNCH_UNCONFIRMED' });
  await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  f.calls.length = 0; await f.reopened().assertTaskIssued(f.vmId, 'default', f.owner.runId, result);
  assert.deepEqual(f.calls, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: bindings only advance after runs stop and a lost rebind reply is recovered by exact next revision
 * 状态影响 / State effects: `f.core.rebind`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `assert.rejects`, `f.scopes.identity`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.identity(f.vmId, next), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' })`; `assert.rejects(f.scopes.identity(f.vmId, next), { code: 'PROJECT_IDENTITY_CONTROL_FAILED' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('bindings only advance after runs stop and a lost rebind reply is recovered by exact next revision', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  const next = { ...f.project, directory: '/workspace/next' };
  await assert.rejects(f.scopes.identity(f.vmId, next), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  const original = f.core.rebind; f.core.rebind = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: args。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: bindings only advance after runs stop and a lost rebind reply is recovered by exact next revision
   * 失败 / Failure: `new AppError('reply lost', 502, 'PROJECT_IDENTITY_CONTROL_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `original`.
   */
  async (...args) => {
    await original(...args); throw new AppError('reply lost', 502, 'PROJECT_IDENTITY_CONTROL_FAILED');
  };
  await assert.rejects(f.scopes.identity(f.vmId, next), { code: 'PROJECT_IDENTITY_CONTROL_FAILED' });
  assert.equal((await f.view()).pending.kind, 'rebind');
  assert.equal((await f.reopened().identity(f.vmId, next)).revision, 2);
  assert.equal((await f.view()).pending, null);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: corrupt host records and escaped lock access refuse operations instead of resetting state
 * 协作入口 / Collaborators: `fixture`, `f.scopes.identity`, `f.scopes.withLock`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(access.identity(f.project), { code: 'PROJECT_IDENTITY_HOST_CHANGED' })`; `assert.rejects(f.scopes.reserve(f.vmId, f.project), { code: 'PROJECT_IDENTITY_HOST_CHANGED' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('corrupt host records and escaped lock access refuse operations instead of resetting state', async () => {
  const f = await fixture(); await f.scopes.identity(f.vmId, f.project);
  let access!: Parameters<Parameters<ProjectRunScopes['withLock']>[2]>[0];
  await f.scopes.withLock(f.vmId, 'default', async value => { access = value; });
  await assert.rejects(access.identity(f.project), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  await writeFile(f.file, '{bad', 'utf8');
  await assert.rejects(f.scopes.reserve(f.vmId, f.project), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(await readFile(f.file, 'utf8'), '{bad');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pending or corrupt migration latches stop payload admission while the explicit migration closure can activate its account
 * 协作入口 / Collaborators: `fixture`, `f.setDirectoryLatch`, `assert.rejects`, `f.scopes.inherited`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.inherited(f.vmId, f.project, { command: 'must-not-run' }, f.owner), { code: 'PROJECT_DIRECTORY_LATCH_CHANG…`; `assert.equal(f.calls.includes('payload'), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('pending or corrupt migration latches stop payload admission while the explicit migration closure can activate its account', async () => {
  const f = await fixture(); f.setDirectoryLatch({ invalid: true });
  await assert.rejects(f.scopes.inherited(f.vmId, f.project, { command: 'must-not-run' }, f.owner),
    { code: 'PROJECT_DIRECTORY_LATCH_CHANGED' });
  assert.equal(f.calls.includes('payload'), false); assert.equal((await f.view()).runs.length, 0);
  await f.scopes.withLock(f.vmId, 'default', async access => {
    assert.equal((await access.identity(f.project)).identityId, f.identity.identityId);
  });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: idempotent start requires an active pinned guest ticket, not just an intent in host storage
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `f.setMissing`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(await f.scopes.active(f.vmId, 'default', f.owner.runId), false)`; `assert.equal((await f.view()).runs[0].phase, 'intent')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('idempotent start requires an active pinned guest ticket, not just an intent in host storage', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  f.setMissing(true); assert.equal(await f.scopes.active(f.vmId, 'default', f.owner.runId), false);
  assert.equal((await f.view()).runs[0].phase, 'intent');
  f.setMissing(false); assert.equal(await f.scopes.active(f.vmId, 'default', f.owner.runId), true);
  assert.deepEqual((await f.view()).runs[0].run, f.run);
  f.setMissing(true); await assert.rejects(f.scopes.active(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_RECORD_ABSENT' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: readonly account state performs no install, mutation, or host receipt advancement
 * 状态影响 / State effects: `f.calls.length`, `f.core.runReadonly`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `readFile`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(await f.scopes.readonlyActive(f.vmId, 'default', f.owner.runId), true)`; `assert.deepEqual(f.calls, ['run-readonly'])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('readonly account state performs no install, mutation, or host receipt advancement', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  const before = await readFile(f.file, 'utf8'); f.calls.length = 0;
  assert.equal(await f.scopes.readonlyActive(f.vmId, 'default', f.owner.runId), true);
  assert.deepEqual(f.calls, ['run-readonly']); assert.equal(await readFile(f.file, 'utf8'), before);
  f.core.runReadonly = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...f.run, bootId: randomUUID() })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...f.run, bootId: randomUUID() })`) through a Promise.
   * 验证场景 / Scenario: readonly account state performs no install, mutation, or host receipt advancement
   * 协作入口 / Collaborators: `randomUUID`.
   */
  async () => ({ ...f.run, bootId: randomUUID() });
  await assert.rejects(f.scopes.readonlyActive(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(await readFile(f.file, 'utf8'), before);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a stable different kernel boot retires the old host scope without forging or stopping its guest ticket
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `assert.equal`, `f.scopes.active`.
 * 检查边界 / Checked boundaries: `assert.equal(await f.scopes.active(f.vmId, 'default', f.owner.runId), true)`; `assert.deepEqual(f.calls, ['confirm', 'confirm'])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a stable different kernel boot retires the old host scope without forging or stopping its guest ticket', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  assert.equal(await f.scopes.active(f.vmId, 'default', f.owner.runId), true);
  const bootId = randomUUID(); f.setBoot(bootId); f.setMissing(true); f.calls.length = 0;
  await f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  assert.deepEqual(f.calls, ['confirm', 'confirm']);
  const entry = (await f.view()).runs[0]; assert.equal(entry.phase, 'closed');
  assert.deepEqual(entry.run, f.run, 'the original active guest receipt is preserved');
  assert.deepEqual(entry.retirement, { reason: 'guest-reboot', bootId });
  await f.reopened().guard(f.vmId, 'default');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: boot changes during retirement or a replacement outer domain keep the old ticket unconfirmed
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `f.scopes.active`, `f.setBoot`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('boot changes during retirement or a replacement outer domain keep the old ticket unconfirmed', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  await f.scopes.active(f.vmId, 'default', f.owner.runId); f.setBoot(randomUUID()); f.setAbsent(false);
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  f.setAbsent(true); const before = await readFile(f.file, 'utf8'), exec = f.machines.exec;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: boot changes during retirement or a replacement outer domain keep the old ticket unconfirmed
   * 协作入口 / Collaborators: `exec`, `f.setBoot`, `randomUUID`.
   */
  async (...args) => { const result = await exec(...args); f.setBoot(randomUUID()); return result; };
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.calls.includes('stop'), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: recovering stopped one-shot tasks retries exact closure and does not retire main or service ownership
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `f.view`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal((await f.view()).runs[0].phase, 'intent')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('recovering stopped one-shot tasks retries exact closure and does not retire main or service ownership', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  const journal = await f.view(), task = journal.runs[0], mainId = randomUUID(), serviceId = randomUUID();
  journal.runs.push({ ...task, runId: mainId, owner: { ...task.owner, kind: 'main', runId: mainId } },
    { ...task, runId: serviceId, owner: { ...task.owner, kind: 'service', runId: serviceId } });
  await writeFile(f.file, JSON.stringify(journal)); f.setAbsent(false);
  await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal((await f.view()).runs[0].phase, 'intent');
  f.setAbsent(true); f.calls.length = 0;
  await f.reopened().recoverStoppedTasks(f.vmId, 'default');
  assert.deepEqual(f.calls, ['confirm', 'run', 'confirm', 'stop']);
  const current = await f.view(); assert.equal(current.runs[0].phase, 'closed');
  assert.equal(current.runs[1].phase, 'intent'); assert.equal(current.runs[2].phase, 'intent');
});

/**
 * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
 * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
 * 输入 / Inputs: f: Awaited<ReturnType<typeof fixture>>。
 * 结果：返回分支计算值（`journal`），以 Promise 交付。
 * Result: Return the branch-computed value (`journal`) through a Promise.
 * 状态影响 / State effects: `journal.runs`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `f.scopes.inherited`, `f.scopes.closeAfterScopeStopped`, `f.view`, `Array.from`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fullClosedJournal(f: Awaited<ReturnType<typeof fixture>>) {
  await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  const journal = await f.view(), original = journal.runs[0];
  journal.runs = Array.from({ length: 1024 }, (_, index) => {
    const runId = index === 0 ? f.owner.runId : randomUUID();
    return { ...original, runId, owner: { ...original.owner, runId },
      run: { ...original.run, runId, cgroupName: 'sakura-task-' + runId } };
  });
  await writeFile(f.file, JSON.stringify(journal), 'utf8');
  return journal;
}
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: f: Awaited<ReturnType<typeof fixture>>; runId: string。
 * 结果：返回分支计算值（`join(f.file.slice(0, -'default.json'.length), 'default', 'closed-runs', runId + …`）。
 * Result: Return the branch-computed value (`join(f.file.slice(0, -'default.json'.length), 'default', 'closed-runs', runId + …`).
 * 协作入口 / Collaborators: `join`, `f.file.slice`.
 */
const archivePath = (f: Awaited<ReturnType<typeof fixture>>, runId: string) =>
  join(f.file.slice(0, -'default.json'.length), 'default', 'closed-runs', runId + '.json');

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: full closed history is archived durably and old run UUIDs cannot execute again after reload
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `fullClosedJournal`, `randomUUID`, `f.reopened().inherited`.
 * 检查边界 / Checked boundaries: `assert.equal(current.runs.length, 513)`; `assert.equal(current.runs.at(-1).runId, next.runId)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('full closed history is archived durably and old run UUIDs cannot execute again after reload', async () => {
  const f = await fixture(), journal = await fullClosedJournal(f), next = { ...f.owner, runId: randomUUID() };
  await f.reopened().inherited(f.vmId, f.project, { command: 'next task' }, next);
  const current = await f.view(); assert.equal(current.runs.length, 513);
  assert.equal(current.runs.at(-1).runId, next.runId);
  assert.deepEqual(JSON.parse(await readFile(archivePath(f, f.owner.runId), 'utf8')), journal.runs[0]);
  assert.equal(await f.reopened().hasRun(f.vmId, 'default', f.owner.runId), true);
  f.calls.length = 0;
  await f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  assert.equal(await f.reopened().readonlyActive(f.vmId, 'default', f.owner.runId), false);
  assert.deepEqual(f.calls, [], 'known closed history performs no guest operations');
  await assert.rejects(f.reopened().inherited(f.vmId, f.project, { command: 'replayed task' }, f.owner),
    { code: 'PROJECT_IDENTITY_RUN_STALE' });
  assert.equal((await f.view()).runs.length, 513);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an interrupted archive retains every journal entry and verifies prior writes before retry
 * 协作入口 / Collaborators: `fixture`, `fullClosedJournal`, `mkdir`, `join`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().inherited(f.vmId, f.project, { command: 'next' }, { ...f.owner, runId: randomUUID() }), { code: 'PROJE…`; `assert.deepEqual((await f.view()).runs, JSON.parse(before).runs)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('an interrupted archive retains every journal entry and verifies prior writes before retry', async () => {
  const f = await fixture(), journal = await fullClosedJournal(f);
  await mkdir(join(f.file.slice(0, -'default.json'.length), 'default', 'closed-runs'), { recursive: true });
  await writeFile(archivePath(f, journal.runs[0].runId), JSON.stringify(journal.runs[0]));
  await writeFile(archivePath(f, journal.runs[1].runId), JSON.stringify({ ...journal.runs[1], sha256: 'b'.repeat(64) }));
  const before = await readFile(f.file, 'utf8');
  await assert.rejects(f.reopened().inherited(f.vmId, f.project, { command: 'next' }, { ...f.owner, runId: randomUUID() }),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.deepEqual((await f.view()).runs, JSON.parse(before).runs);
  await writeFile(archivePath(f, journal.runs[1].runId), JSON.stringify(journal.runs[1]));
  await f.reopened().inherited(f.vmId, f.project, { command: 'retry' }, { ...f.owner, runId: randomUUID() });
  assert.equal((await f.view()).runs.length, 513);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: corrupt or nonclosed archives are errors and never treated as missing history
 * 协作入口 / Collaborators: `fixture`, `f.scopes.identity`, `archivePath`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.hasRun(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' })`; `assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('corrupt or nonclosed archives are errors and never treated as missing history', async () => {
  const f = await fixture(); await f.scopes.identity(f.vmId, f.project);
  const path = archivePath(f, f.owner.runId);
  await mkdir(join(f.file.slice(0, -'default.json'.length), 'default', 'closed-runs'), { recursive: true });
  await writeFile(path, '{bad');
  await assert.rejects(f.scopes.hasRun(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.deepEqual(f.calls, ['ensure']);
  await writeFile(path, 'null');
  await assert.rejects(f.scopes.hasRun(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  await writeFile(path, JSON.stringify({ version: 1, projectId: 'default', identity: f.identity, runId: f.owner.runId,
    owner: f.owner, sha256: 'a'.repeat(64), phase: 'active', run: f.run }));
  await assert.rejects(f.scopes.hasRun(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
});

/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: f: Awaited<ReturnType<typeof fixture>>。
 * 结果：返回分支计算值（`state`）。
 * Result: Return the branch-computed value (`state`).
 * 协作入口 / Collaborators: `Object.assign`.
 */
function networkCore(f: Awaited<ReturnType<typeof fixture>>) {
  const leases = new Map<string, { version: 1; phase: 'pending'; releaseId: string; network: {
    version: 1; projectId: string; registryId: string; identityId: string; revision: number; bootId: string;
    namespace: string; networkDevice: string; networkInode: string; generation: string } }>();
  const state = { loseBegin: false, loseRelease: false, absent: false, begins: [] as string[], releases: [] as string[] };
  Object.assign(f.core, {
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: _vm: string; identity: typeof f.identity; options: { releaseId: string; bootId: string }。
     * 结果：返回分支计算值（`null / lease`），以 Promise 交付。
     * Result: Return the branch-computed value (`null / lease`) through a Promise.
     * 状态影响 / State effects: `lease`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new AppError('begin acknowledgement lost', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `state.begins.push`, `leases.get`, `randomUUID`, `leases.set`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    beginNetworkRelease: async (_vm: string, identity: typeof f.identity, options: { releaseId: string; bootId: string }) => {
      state.begins.push(options.releaseId);
      if (state.absent) return null;
      let lease = leases.get(options.releaseId);
      if (!lease) {
        lease = { version: 1, phase: 'pending', releaseId: options.releaseId, network: { version: 1,
          projectId: identity.projectId, registryId: identity.registryId, identityId: identity.identityId,
          revision: identity.revision, bootId: options.bootId, namespace: 'sk-' + identity.projectId,
          networkDevice: '4', networkInode: '5', generation: randomUUID() } };
        leases.set(options.releaseId, lease);
      }
      if (state.loseBegin) throw new AppError('begin acknowledgement lost', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      return lease;
    },
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: _vm: string; _identity: typeof f.identity; lease: NonNullable<ReturnType<typeof leases.get>>。
     * 结果：返回受控对象，公开字段包括 `version, phase, releaseId, network`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `version, phase, releaseId, network`; the actual branch determines its shape.
     * 失败 / Failure: `new AppError('release acknowledgement lost', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `state.releases.push`, `assert.deepEqual`, `leases.get`.
     * 检查边界 / Checked boundaries: `assert.deepEqual(lease, leases.get(lease.releaseId))`.
     */
    releaseNetwork: async (_vm: string, _identity: typeof f.identity, lease: NonNullable<ReturnType<typeof leases.get>>) => {
      state.releases.push(lease.releaseId);
      assert.deepEqual(lease, leases.get(lease.releaseId));
      if (state.loseRelease) throw new AppError('release acknowledgement lost', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      return { version: 1, phase: 'released', releaseId: lease.releaseId, network: lease.network };
    },
  });
  return state;
}
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`f`），以 Promise 交付。
 * Result: Return the branch-computed value (`f`) through a Promise.
 * 状态影响 / State effects: `f.project.networkIsolation`, `f.identity.networkIsolation`, `f.run.namespace`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.setIdentity`.
 */
async function privateNetworkFixture() {
  const f = await fixture(); f.project.networkIsolation = 'private'; f.identity.networkIsolation = 'private';
  f.setIdentity({ ...f.identity }); f.run.namespace = 'sk-default'; return f;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network release captures one generation before stop and blocks admissions until its exact completion
 * 协作入口 / Collaborators: `privateNetworkFixture`, `f.scopes.inherited`, `networkCore`, `f.scopes.beginNetworkRelease`.
 * 检查边界 / Checked boundaries: `assert.ok(intent?.lease)`; `assert.deepEqual((await f.view()).networkRelease.intent, intent)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('network release captures one generation before stop and blocks admissions until its exact completion', async () => {
  const f = await privateNetworkFixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'old run' }, f.owner);
  const state = networkCore(f), intent = await f.scopes.beginNetworkRelease(f.vmId, 'default'); assert.ok(intent?.lease);
  assert.deepEqual((await f.view()).networkRelease.intent, intent);
  await assert.rejects(f.reopened().identity(f.vmId, f.project), { code: 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING' });
  await assert.rejects(f.reopened().assertAdmission(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING' });
  f.setAbsent(false);
  await assert.rejects(f.reopened().releaseNetwork(f.vmId, 'default', intent), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.deepEqual(state.releases, []);
  f.setAbsent(true); await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  await f.reopened().releaseNetwork(f.vmId, 'default', intent);
  assert.equal((await f.view()).networkRelease.phase, 'released');
  assert.deepEqual(state.releases, [intent.releaseId]); await f.scopes.assertAdmission(f.vmId, 'default');
  await f.scopes.releaseNetwork(f.vmId, 'default', intent); assert.deepEqual(state.releases, [intent.releaseId]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lost network begin and release replies preserve UUID and generation across manager reload
 * 状态影响 / State effects: `state.loseBegin`, `state.loseRelease`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `privateNetworkFixture`, `f.scopes.identity`, `networkCore`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.beginNetworkRelease(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED' })`; `assert.equal(original.phase, 'intent')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('lost network begin and release replies preserve UUID and generation across manager reload', async () => {
  const f = await privateNetworkFixture(); await f.scopes.identity(f.vmId, f.project); const state = networkCore(f);
  state.loseBegin = true;
  await assert.rejects(f.scopes.beginNetworkRelease(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED' });
  const original = (await f.view()).networkRelease; assert.equal(original.phase, 'intent'); assert.equal(original.intent.lease, null);
  state.loseBegin = false; const intent = await f.reopened().beginNetworkRelease(f.vmId, 'default'); assert.ok(intent?.lease);
  assert.equal(intent.releaseId, original.intent.releaseId); assert.deepEqual(state.begins, [intent.releaseId, intent.releaseId]);
  state.loseRelease = true;
  await assert.rejects(f.reopened().releaseNetwork(f.vmId, 'default', intent), { code: 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED' });
  assert.equal((await f.view()).networkRelease.phase, 'pending');
  state.loseRelease = false; await f.reopened().releaseNetwork(f.vmId, 'default', intent);
  assert.deepEqual(state.releases, [intent.releaseId, intent.releaseId]);
  const next = await f.reopened().beginNetworkRelease(f.vmId, 'default'); assert.ok(next?.lease);
  assert.notEqual(next.releaseId, intent.releaseId); assert.notEqual(next.lease.network.generation, intent.lease.network.generation);
  const count = state.releases.length;
  await assert.rejects(f.reopened().releaseNetwork(f.vmId, 'default', intent), { code: 'PROJECT_IDENTITY_NETWORK_STALE' });
  assert.equal(state.releases.length, count, 'late cleanup never follows the new generation');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a managed absent network is retained as an intent and never falls through to legacy deletion
 * 状态影响 / State effects: `state.absent`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `privateNetworkFixture`, `assert.equal`, `f.scopes.beginNetworkRelease`, `f.scopes.identity`.
 * 检查边界 / Checked boundaries: `assert.equal(await f.scopes.beginNetworkRelease(f.vmId, 'default'), null)`; `assert.ok(intent)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a managed absent network is retained as an intent and never falls through to legacy deletion', async () => {
  const f = await privateNetworkFixture(); assert.equal(await f.scopes.beginNetworkRelease(f.vmId, 'default'), null);
  await f.scopes.identity(f.vmId, f.project); const state = networkCore(f); state.absent = true;
  const intent = await f.scopes.beginNetworkRelease(f.vmId, 'default'); assert.ok(intent); assert.equal(intent.lease, null);
  await f.scopes.releaseNetwork(f.vmId, 'default', intent); assert.deepEqual(state.releases, []);
  assert.equal((await f.view()).networkRelease.phase, 'released');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a lost begin reply followed by a different boot cannot capture or delete a current namespace
 * 状态影响 / State effects: `state.loseBegin`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `privateNetworkFixture`, `f.scopes.identity`, `networkCore`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.beginNetworkRelease(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED' })`; `assert.rejects(f.reopened().beginNetworkRelease(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a lost begin reply followed by a different boot cannot capture or delete a current namespace', async () => {
  const f = await privateNetworkFixture(); await f.scopes.identity(f.vmId, f.project); const state = networkCore(f); state.loseBegin = true;
  await assert.rejects(f.scopes.beginNetworkRelease(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED' });
  const original = (await f.view()).networkRelease.intent;
  f.setBoot(randomUUID()); f.setAbsent(false);
  await assert.rejects(f.reopened().beginNetworkRelease(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED' });
  assert.equal(state.begins.length, 1);
  f.setAbsent(true); const intent = await f.reopened().beginNetworkRelease(f.vmId, 'default'); assert.ok(intent);
  assert.deepEqual(intent, original); assert.equal(intent.lease, null); assert.equal(state.begins.length, 1);
  await f.scopes.releaseNetwork(f.vmId, 'default', intent); assert.deepEqual(state.releases, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: atomic task admission permits two real owners while binding and network guards keep their durable tickets
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.setAbsent`, `f.scopes.admitTask`, `f.reopened().admitTask`.
 * 检查边界 / Checked boundaries: `assert.notEqual(first.payload.runId, second.payload.runId)`; `assert.equal((await f.view()).runs.length, 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('atomic task admission permits two real owners while binding and network guards keep their durable tickets', async () => {
  const f = await fixture(), signal = new AbortController().signal; f.setAbsent(false);
  const first = await f.scopes.admitTask(f.vmId, f.project, { command: 'first' }, signal);
  const second = await f.reopened().admitTask(f.vmId, f.project, { command: 'second' }, signal);
  try {
    assert.notEqual(first.payload.runId, second.payload.runId);
    assert.equal((await f.view()).runs.length, 2);
    f.calls.length = 0;
    await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.deepEqual(f.calls, [], 'confirmed in-process owners are not probed as lost tasks');
    await assert.rejects(f.scopes.guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
    const next = { ...f.project, directory: '/workspace/other' };
    await assert.rejects(f.reopened().identity(f.vmId, next), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
    assert.equal((await f.view()).runs.every((entry: { phase: string }) => entry.phase === 'intent'), true);
    first.release();
    await assert.rejects(f.reopened().admitTask(f.vmId, f.project, { command: 'third' }, signal),
      { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    assert.equal((await f.view()).runs.length, 2, 'a released but populated owner prevents a new payload');
  } finally { first.release(); second.release(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: all manager instances queue admission checks behind the same fail-fast Machines lock
 * 状态影响 / State effects: `f.core.ensure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.admitTask`, `assert.equal`, `f.view`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.view()).pending.kind, 'ensure')`; `assert.equal(checked, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('all manager instances queue admission checks behind the same fail-fast Machines lock', async () => {
  const f = await fixture(), signal = new AbortController().signal;
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, resume!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { resume = resolve; });
  const ensure = f.core.ensure;
  f.core.ensure = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`ensure(...args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`ensure(...args)`) through a Promise.
   * 验证场景 / Scenario: all manager instances queue admission checks behind the same fail-fast Machines lock
   * 协作入口 / Collaborators: `entered`, `ensure`.
   */
  async (...args) => { entered(); await barrier; return ensure(...args); };
  const admission = f.scopes.admitTask(f.vmId, f.project, { command: 'first' }, signal);
  await started;
  assert.equal((await f.view()).pending.kind, 'ensure');
  let checked = false;
  const check = f.reopened().assertAdmission(f.vmId, 'default').then(() => { checked = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(checked, false);
  resume();
  const owner = await admission;
  try { await check; assert.equal(checked, true); }
  finally { owner.release(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancellation preserves an admitted owner until cleanup and receipt classification explicitly release it
 * 协作入口 / Collaborators: `fixture`, `f.setAbsent`, `f.scopes.admitTask`, `controller.abort`.
 * 检查边界 / Checked boundaries: `assert.equal(f.calls.includes('confirm'), false)`; `assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('cancellation preserves an admitted owner until cleanup and receipt classification explicitly release it', async () => {
  const f = await fixture(), controller = new AbortController(); f.setAbsent(false);
  const owner = await f.scopes.admitTask(f.vmId, f.project, { command: 'sleep' }, controller.signal);
  controller.abort();
  try {
    await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.equal(f.calls.includes('confirm'), false);
    await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  } finally { owner.release(); }
  await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  f.setAbsent(true); f.setMissing(true);
  await f.reopened().recoverStoppedTasks(f.vmId, 'default');
  assert.equal((await f.view()).runs[0].phase, 'closed');
  await f.reopened().guard(f.vmId, 'default');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stored task intents never become in-process owners without admission
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `f.setAbsent`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().admitTask(f.vmId, f.project, { command: 'new' }, new AbortController().signal), { code: 'PROJECT_IDENT…`; `assert.equal(f.calls.filter(value => value === 'payload').length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('stored task intents never become in-process owners without admission', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'orphan' }, f.owner);
  f.setAbsent(false);
  await assert.rejects(f.reopened().admitTask(f.vmId, f.project, { command: 'new' }, new AbortController().signal),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(f.calls.filter(value => value === 'payload').length, 1);
  assert.equal((await f.view()).runs.length, 1);
});

for (const field of ['sha256', 'owner', 'identity'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `journal.runs[0].sha256`, `journal.runs[0].owner.bootId`, `journal.runs[0].identity.homeInode`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `fixture`, `f.scopes.admitTask`, `f.setAbsent`, `f.view`.
   * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test('concurrent recovery refuses a changed admitted ' + field, async () => {
    const f = await fixture(), owner = await f.scopes.admitTask(f.vmId, f.project,
      { command: 'active' }, new AbortController().signal); f.setAbsent(false);
    try {
      const journal = await f.view();
      if (field === 'sha256') journal.runs[0].sha256 = 'b'.repeat(64);
      if (field === 'owner') journal.runs[0].owner.bootId = randomUUID();
      if (field === 'identity') journal.runs[0].identity.homeInode = '999';
      await writeFile(f.file, JSON.stringify(journal));
      await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    } finally { owner.release(); }
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a pinned full native receipt is skipped only while every exact field still matches
 * 状态影响 / State effects: `f.core.run`, `journal.runs[0].run.cgroupInode`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.admitTask`, `f.setAbsent`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(await f.reopened().active(f.vmId, 'default', owner.payload.runId), true)`; `assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a pinned full native receipt is skipped only while every exact field still matches', async () => {
  const f = await fixture(), owner = await f.scopes.admitTask(f.vmId, f.project,
    { command: 'active' }, new AbortController().signal); f.setAbsent(false);
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...f.run, runId: owner.payload.runId, cgroupName: 'sakura-task-' + owner.payl…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...f.run, runId: owner.payload.runId, cgroupName: 'sakura-task-' + owner.payl…`) through a Promise.
   * 验证场景 / Scenario: a pinned full native receipt is skipped only while every exact field still matches
   */
  async () => ({ ...f.run, runId: owner.payload.runId, cgroupName: 'sakura-task-' + owner.payload.runId });
  try {
    assert.equal(await f.reopened().active(f.vmId, 'default', owner.payload.runId), true);
    await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    const journal = await f.view(); journal.runs[0].run.cgroupInode = '999';
    await writeFile(f.file, JSON.stringify(journal));
    await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  } finally { owner.release(); }
});

for (const change of ['live', 'boot', 'machines'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixture`, `f.scopes.admitTask`, `f.setAbsent`, `f.machines.live.set`.
   * 检查边界 / Checked boundaries: `assert.rejects(manager.recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test('new ' + change + ' state cannot adopt an in-process active task from disk', async () => {
    const f = await fixture(), owner = await f.scopes.admitTask(f.vmId, f.project,
      { command: 'active' }, new AbortController().signal); f.setAbsent(false);
    try {
      if (change === 'live') f.machines.live.set(f.vmId, {} as never);
      if (change === 'boot') f.setBoot(randomUUID());
      const manager = change === 'machines' ? new ProjectRunScopes({ ...f.machines } as Machines,
        { identities: f.core, rootDirectory: dirname(dirname(f.file)) }) : f.reopened();
      // path uses the original host journal; a new Machines object has no active owner.
      await assert.rejects(manager.recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    } finally { owner.release(); }
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: admission rejects a changed boot before registration and keeps the exact unexecuted intent recoverable
 * 状态影响 / State effects: `f.core.inheritedInput`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.scopes.admitTask`, `f.view`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must not execute' }, new AbortController().signal), { code: 'PROJ…`; `assert.equal(before.runs.length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('admission rejects a changed boot before registration and keeps the exact unexecuted intent recoverable', async () => {
  const f = await fixture(), inherited = f.core.inheritedInput;
  f.core.inheritedInput = /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`payload`），以 Promise 交付。
   * Result: Return the branch-computed value (`payload`) through a Promise.
   * 验证场景 / Scenario: admission rejects a changed boot before registration and keeps the exact unexecuted intent recoverable
   * 协作入口 / Collaborators: `inherited`, `f.setBoot`, `randomUUID`.
   */
  async (...args) => { const payload = await inherited(...args); f.setBoot(randomUUID()); return payload; };
  await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must not execute' }, new AbortController().signal),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  const before = await f.view(); assert.equal(before.runs.length, 1); assert.equal(before.runs[0].phase, 'intent');
  await f.reopened().recoverStoppedTasks(f.vmId, 'default');
  assert.equal((await f.view()).runs[0].phase, 'closed');
  assert.equal(f.calls.includes('stop'), false, 'old-boot intent retires without an old guest stop');
});

for (const field of ['runId', 'sha256'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `f.core.inheritedInput`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.scopes.admitTask`, `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must not execute' }, new AbortController().signal), { code: 'PROJ…`; `assert.equal((await f.view()).runs.length, 0)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test('admission refuses a mismatched protected payload ' + field + ' before journaling or execution', async () => {
    const f = await fixture(), inherited = f.core.inheritedInput;
    f.core.inheritedInput = /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`({ ...await inherited(...args), [field]: field === 'runId' ? randomUUID() : 'b'.…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ...await inherited(...args), [field]: field === 'runId' ? randomUUID() : 'b'.…`) through a Promise.
     * 协作入口 / Collaborators: `inherited`, `randomUUID`, `'b'.repeat`.
     */
    async (...args) => ({ ...await inherited(...args),
      [field]: field === 'runId' ? randomUUID() : 'b'.repeat(64) });
    await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must not execute' }, new AbortController().signal),
      { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal((await f.view()).runs.length, 0);
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the captured live instance is mandatory when a prepared task enters the atomic admission
 * 协作入口 / Collaborators: `fixture`, `f.machines.live.get`, `f.machines.live.set`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must not run' }, new AbortController().signal, { expectedLive }),…`; `assert.deepEqual(f.calls, [])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('the captured live instance is mandatory when a prepared task enters the atomic admission', async () => {
  const f = await fixture(), expectedLive = f.machines.live.get(f.vmId)!;
  f.machines.live.set(f.vmId, {} as never);
  await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must not run' },
    new AbortController().signal, { expectedLive }), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.deepEqual(f.calls, []);
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a live replacement after durable intent creation keeps the unexecuted ticket and refuses registration
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.machines.live.get`, `assert.rejects`, `f.scopes.admitTask`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must not run' }, new AbortController().signal, { expectedLive }),…`; `assert.equal((await f.view()).runs[0].phase, 'intent')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a live replacement after durable intent creation keeps the unexecuted ticket and refuses registration', async () => {
  const f = await fixture(), expectedLive = f.machines.live.get(f.vmId)!, execute = f.machines.exec;
  let bootReads = 0;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: a live replacement after durable intent creation keeps the unexecuted ticket and refuses registration
   * 协作入口 / Collaborators: `execute`, `args[1].trim().endsWith`, `args[1].trim`, `f.machines.live.set`.
   */
  async (...args) => {
    const result = await execute(...args);
    if (args[1].trim().endsWith('/proc/sys/kernel/random/boot_id') && ++bootReads === 2)
      f.machines.live.set(f.vmId, {} as never);
    return result;
  };
  await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must not run' },
    new AbortController().signal, { expectedLive }), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal((await f.view()).runs[0].phase, 'intent');
  f.setAbsent(false);
  await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network retirement cannot use an active task registration to waive the nonclosed-run guard
 * 协作入口 / Collaborators: `privateNetworkFixture`, `f.scopes.admitTask`, `networkCore`, `f.setAbsent`.
 * 检查边界 / Checked boundaries: `assert.ok(intent)`; `assert.rejects(f.reopened().releaseNetwork(f.vmId, 'default', intent), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('network retirement cannot use an active task registration to waive the nonclosed-run guard', async () => {
  const f = await privateNetworkFixture(), owner = await f.scopes.admitTask(f.vmId, f.project,
    { command: 'active' }, new AbortController().signal), state = networkCore(f); f.setAbsent(false);
  try {
    const intent = await f.reopened().beginNetworkRelease(f.vmId, 'default'); assert.ok(intent);
    await assert.rejects(f.reopened().releaseNetwork(f.vmId, 'default', intent), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
    assert.deepEqual(state.releases, []);
    await assert.rejects(f.scopes.guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING' });
  } finally { owner.release(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a full ticket pinned during owned cleanup remains in-process until the complete task finally finishes
 * 状态影响 / State effects: `f.core.run`, `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.admitTask`, `f.setCleanupFail`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', owner.payload.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' …`; `assert.deepEqual(f.calls, [], 'active cleanup does not become an orphan between its retries')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a full ticket pinned during owned cleanup remains in-process until the complete task finally finishes', async () => {
  const f = await fixture(), owner = await f.scopes.admitTask(f.vmId, f.project,
    { command: 'active' }, new AbortController().signal); f.setCleanupFail(true);
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...f.run, runId: owner.payload.runId, cgroupName: 'sakura-task-' + owner.payl…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...f.run, runId: owner.payload.runId, cgroupName: 'sakura-task-' + owner.payl…`) through a Promise.
   * 验证场景 / Scenario: a full ticket pinned during owned cleanup remains in-process until the complete task finally finishes
   */
  async () => ({ ...f.run, runId: owner.payload.runId, cgroupName: 'sakura-task-' + owner.payload.runId });
  try {
    await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', owner.payload.runId),
      { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    f.calls.length = 0;
    await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.deepEqual(f.calls, [], 'active cleanup does not become an orphan between its retries');
  } finally { owner.release(); }
  await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
});

/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`({ version: 1 as const, kind: 'ssh-agent' as const, leaseId: randomUUID(), broke…`）。
 * Result: Return the branch-computed value (`({ version: 1 as const, kind: 'ssh-agent' as const, leaseId: randomUUID(), broke…`).
 * 协作入口 / Collaborators: `randomUUID`, `'a'.repeat`.
 */
const agentResource = () => ({ version: 1 as const, kind: 'ssh-agent' as const, leaseId: randomUUID(),
  brokerSha256: 'a'.repeat(64), timeoutSeconds: 60 });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Agent resources persist before payload execution and close before the account ticket
 * 状态影响 / State effects: `f.core.run`, `f.core.stop`, `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `agentResource`, `f.scopes.admitTask`, `f.view`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(stored.runs[0].sshAgent, resource)`; `assert.ok(!JSON.stringify(stored).includes('private-frame-value') && !JSON.stringify(stored).includes('/wrong/project/socket'))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('Agent resources persist before payload execution and close before the account ticket', async () => {
  const contexts: SshAgentContext[] = [], f = await fixture(async context => { contexts.push(context); f.calls.push('agent-cleanup'); });
  const agent = new OwnedForwardAgent('unit-unused-agent', new AbortController().signal), resource = agentResource();
  const admitted = await f.scopes.admitTask(f.vmId, f.project, { command: 'private-frame-value',
    environment: { SSH_AUTH_SOCK: '/wrong/project/socket' } }, new AbortController().signal,
    { sshAgent: { resource, agent } });
  const runId = admitted.payload.runId;
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `runId, cgroupName`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `runId, cgroupName`; the actual branch determines its shape.
   * 验证场景 / Scenario: Agent resources persist before payload execution and close before the account ticket
   * 协作入口 / Collaborators: `f.calls.push`.
   */
  async () => { f.calls.push('run'); return { ...f.run, runId, cgroupName: 'sakura-task-' + runId }; };
  f.core.stop = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `runId, cgroupName, phase`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `runId, cgroupName, phase`; the actual branch determines its shape.
   * 验证场景 / Scenario: Agent resources persist before payload execution and close before the account ticket
   * 协作入口 / Collaborators: `f.calls.push`.
   */
  async () => { f.calls.push('stop'); return { ...f.run, runId, cgroupName: 'sakura-task-' + runId, phase: 'closed' }; };
  try {
    const stored = await f.view(); assert.deepEqual(stored.runs[0].sshAgent, resource);
    assert.ok(!JSON.stringify(stored).includes('private-frame-value') && !JSON.stringify(stored).includes('/wrong/project/socket'));
    assert.deepEqual(admitted.agentContext?.identity, f.identity); assert.equal(admitted.agentContext?.owner.runId, runId);
    f.calls.length = 0;
    await f.scopes.closeAfterScopeStopped(f.vmId, 'default', runId);
    assert.equal(contexts.length, 1); assert.equal(contexts[0].resource.leaseId, resource.leaseId);
    assert.ok(f.calls.indexOf('agent-cleanup') > f.calls.indexOf('confirm'));
    assert.ok(f.calls.indexOf('agent-cleanup') < f.calls.indexOf('stop'));
    assert.equal((await f.view()).runs[0].phase, 'closed');
  } finally { admitted.release(); await agent.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a failed Agent resource cleanup stays recoverable even when native has already returned closed
 * 状态影响 / State effects: `f.core.run`, `failed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `agentResource`, `f.scopes.admitTask`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(await f.scopes.active(f.vmId, 'default', admitted.payload.runId), false)`; `assert.equal((await f.view()).runs[0].phase, 'active', 'a closed native ticket cannot hide unresolved Agent resources')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a failed Agent resource cleanup stays recoverable even when native has already returned closed', async () => {
  let failed = true, attempts = 0;
  const f = await fixture(async () => { ++attempts; if (failed) throw new AppError('host stream close unconfirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'); });
  const agent = new OwnedForwardAgent('unit-unused-agent', new AbortController().signal), resource = agentResource();
  const admitted = await f.scopes.admitTask(f.vmId, f.project, { command: 'true' }, new AbortController().signal,
    { sshAgent: { resource, agent } });
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...f.run, runId: admitted.payload.runId, cgroupName: 'sakura-task-' + admitte…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...f.run, runId: admitted.payload.runId, cgroupName: 'sakura-task-' + admitte…`) through a Promise.
   * 验证场景 / Scenario: a failed Agent resource cleanup stays recoverable even when native has already returned closed
   */
  async () => ({ ...f.run, runId: admitted.payload.runId,
    cgroupName: 'sakura-task-' + admitted.payload.runId, phase: 'closed' });
  try {
    assert.equal(await f.scopes.active(f.vmId, 'default', admitted.payload.runId), false);
    assert.equal((await f.view()).runs[0].phase, 'active', 'a closed native ticket cannot hide unresolved Agent resources');
    await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', admitted.payload.runId),
      { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    assert.equal((await f.view()).runs[0].phase, 'active'); assert.equal(f.calls.includes('stop'), false);
    admitted.release();
    await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
    failed = false; await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.equal(attempts, 2); assert.equal((await f.view()).runs[0].phase, 'closed');
    await f.reopened().guard(f.vmId, 'default');
  } finally { admitted.release(); await agent.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an unissued Agent task still cleans its exact resources before accepting native RECORD_ABSENT
 * 协作入口 / Collaborators: `fixture`, `f.scopes.admitTask`, `agentResource`, `f.setMissing`.
 * 检查边界 / Checked boundaries: `assert.ok(f.calls.includes('agent-cleanup'))`; `assert.equal(f.calls.includes('stop'), false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('an unissued Agent task still cleans its exact resources before accepting native RECORD_ABSENT', async () => {
  const f = await fixture(async context => { assert.equal(context.identity.identityId, f.identity.identityId); f.calls.push('agent-cleanup'); });
  const agent = new OwnedForwardAgent('unit-unused-agent', new AbortController().signal);
  const admitted = await f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-run' }, new AbortController().signal,
    { sshAgent: { resource: agentResource(), agent } });
  f.setMissing(true); admitted.release();
  try {
    await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.ok(f.calls.includes('agent-cleanup')); assert.equal(f.calls.includes('stop'), false);
    assert.equal((await f.view()).runs[0].run, null);
    await assert.rejects(f.reopened().assertTaskIssued(f.vmId, 'default', admitted.payload.runId,
      { code: 1, stderr: '', stdout: JSON.stringify({ ok: false, code: 'SSH_AGENT_SOURCE_INVALID', detail: null }) }),
      { code: 'PROJECT_IDENTITY_SSH_AGENT_SOURCE_INVALID' });
  } finally { await agent.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: changing immutable Agent metadata disables the concurrent-task exemption
 * 状态影响 / State effects: `changed.runs[0].sshAgent.leaseId`, `admitted.agentContext!.resource.leaseId`, `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.admitTask`, `agentResource`, `f.setAbsent`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal(f.calls.includes('stop'), false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('changing immutable Agent metadata disables the concurrent-task exemption', async () => {
  const f = await fixture(), agent = new OwnedForwardAgent('unit-unused-agent', new AbortController().signal);
  const admitted = await f.scopes.admitTask(f.vmId, f.project, { command: 'active' }, new AbortController().signal,
    { sshAgent: { resource: agentResource(), agent } }); f.setAbsent(false);
  try {
    const original = await f.view();
    const changed = structuredClone(original); changed.runs[0].sshAgent.leaseId = randomUUID();
    admitted.agentContext!.resource.leaseId = changed.runs[0].sshAgent.leaseId;
    await writeFile(f.file, JSON.stringify(changed));
    await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    assert.equal(f.calls.includes('stop'), false);
    await writeFile(f.file, JSON.stringify(original));
    f.calls.length = 0; await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.deepEqual(f.calls, [], 'the original exact in-process owner still exists');
  } finally { admitted.release(); await agent.close(); }
});

/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `version, kind, leaseId, brokerSha256, timeoutSeconds, hostSourceSha256, hostHelperSha256`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `version, kind, leaseId, brokerSha256, timeoutSeconds, hostSourceSha256, hostHelperSha256`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `syntheticGpgHostSnapshot`, `randomUUID`, `'a'.repeat`.
 */
const gpgResource = () => {
  const snapshot = syntheticGpgHostSnapshot();
  return { version: 1 as const, kind: 'gpg-agent' as const, leaseId: randomUUID(),
    brokerSha256: 'a'.repeat(64), timeoutSeconds: 60,
    hostSourceSha256: snapshot.hostSourceSha256, hostHelperSha256: snapshot.hostHelperSha256 };
};
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`bridge`）。
 * Result: Return the branch-computed value (`bridge`).
 * 状态影响 / State effects: `bridge.prepareAdmission`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syntheticGpgHostSnapshot`.
 */
const gpgBridge = () => {
  const bridge = new OwnedGpgForward(syntheticGpgHostSnapshot(), new AbortController().signal);
  // This file tests the project journal using synthetic host pins. Real helper
  // births and kernel credentials are covered by the separate native smoke.
  bridge.prepareAdmission = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: context; live。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `bridge.bind`.
   */
  async (context, live) => { bridge.bind(context, live); };
  return bridge;
};

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GPG admission pins its source and writable home, and closes the resource before its account ticket
 * 状态影响 / State effects: `f.core.inheritedInput`, `f.core.run`, `f.core.stop`, `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `gpgBridge`, `gpgResource`, `f.scopes.admitTask`.
 * 检查边界 / Checked boundaries: `assert.equal(environment?.GNUPGHOME, gpgAgentHomePath(resource.leaseId))`; `assert.equal(environment?.TOKEN, 'private-environment')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('GPG admission pins its source and writable home, and closes the resource before its account ticket', async () => {
  const contexts: GpgAgentContext[] = [];
  const f = await fixture(undefined, async context => { contexts.push(context); f.calls.push('gpg-cleanup'); });
  const bridge = gpgBridge(), resource = gpgResource(), original = f.core.inheritedInput;
  let environment: Record<string, string> | undefined;
  f.core.inheritedInput = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: identity; execution; options。
   * 结果：返回分支计算值（`original(identity, execution, options)`），以 Promise 交付。
   * Result: Return the branch-computed value (`original(identity, execution, options)`) through a Promise.
   * 验证场景 / Scenario: GPG admission pins its source and writable home, and closes the resource before its account ticket
   * 状态影响 / State effects: `environment`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `original`.
   */
  async (identity, execution, options) => {
    environment = (execution as { environment?: Record<string, string> }).environment;
    return original(identity, execution, options);
  };
  const admitted = await f.scopes.admitTask(f.vmId, f.project,
    { command: 'private-frame-value', environment: { GNUPGHOME: '/wrong/project/home', TOKEN: 'private-environment' } },
    new AbortController().signal, { gpgAgent: { resource, bridge } });
  const runId = admitted.payload.runId;
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `runId, cgroupName`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `runId, cgroupName`; the actual branch determines its shape.
   * 验证场景 / Scenario: GPG admission pins its source and writable home, and closes the resource before its account ticket
   * 协作入口 / Collaborators: `f.calls.push`.
   */
  async () => { f.calls.push('run'); return { ...f.run, runId, cgroupName: 'sakura-task-' + runId }; };
  f.core.stop = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `runId, cgroupName, phase`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `runId, cgroupName, phase`; the actual branch determines its shape.
   * 验证场景 / Scenario: GPG admission pins its source and writable home, and closes the resource before its account ticket
   * 协作入口 / Collaborators: `f.calls.push`.
   */
  async () => { f.calls.push('stop'); return { ...f.run, runId, cgroupName: 'sakura-task-' + runId, phase: 'closed' }; };
  try {
    assert.equal(environment?.GNUPGHOME, gpgAgentHomePath(resource.leaseId));
    assert.equal(environment?.TOKEN, 'private-environment');
    assert.deepEqual((await f.view()).runs[0].gpgAgent, resource);
    const text = await readFile(f.file, 'utf8');
    for (const value of ['private-frame-value', 'private-environment', '/wrong/project/home', 'D:\\private'])
      assert.ok(!text.includes(value));
    assert.deepEqual(admitted.gpgContext?.identity, f.identity);
    assert.equal(admitted.gpgContext?.owner.runId, runId);
    f.calls.length = 0;
    await f.scopes.closeAfterScopeStopped(f.vmId, 'default', runId);
    assert.equal(contexts.length, 1); assert.deepEqual(contexts[0].resource, resource);
    assert.ok(f.calls.indexOf('gpg-cleanup') > f.calls.indexOf('confirm'));
    assert.ok(f.calls.indexOf('gpg-cleanup') < f.calls.indexOf('stop'));
    assert.equal((await f.view()).runs[0].phase, 'closed');
  } finally { admitted.release(); await bridge.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a closed native GPG ticket retains its unresolved resource and recovery retries it
 * 状态影响 / State effects: `f.core.run`, `failed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `gpgBridge`, `f.scopes.admitTask`, `gpgResource`.
 * 检查边界 / Checked boundaries: `assert.equal(await f.scopes.active(f.vmId, 'default', admitted.payload.runId), false)`; `assert.equal((await f.view()).runs[0].phase, 'active')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a closed native GPG ticket retains its unresolved resource and recovery retries it', async () => {
  let failed = true, attempts = 0;
  const f = await fixture(undefined, async () => {
    ++attempts;
    if (failed) throw new AppError('GPG host helper close unconfirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  });
  const bridge = gpgBridge();
  const admitted = await f.scopes.admitTask(f.vmId, f.project, { command: 'true' }, new AbortController().signal,
    { gpgAgent: { resource: gpgResource(), bridge } });
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...f.run, runId: admitted.payload.runId, cgroupName: 'sakura-task-' + admitte…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...f.run, runId: admitted.payload.runId, cgroupName: 'sakura-task-' + admitte…`) through a Promise.
   * 验证场景 / Scenario: a closed native GPG ticket retains its unresolved resource and recovery retries it
   */
  async () => ({ ...f.run, runId: admitted.payload.runId,
    cgroupName: 'sakura-task-' + admitted.payload.runId, phase: 'closed' });
  try {
    assert.equal(await f.scopes.active(f.vmId, 'default', admitted.payload.runId), false);
    assert.equal((await f.view()).runs[0].phase, 'active');
    await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', admitted.payload.runId),
      { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    admitted.release();
    await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
    failed = false; await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.equal(attempts, 2); assert.equal((await f.view()).runs[0].phase, 'closed');
    assert.equal(f.calls.includes('stop'), false);
  } finally { admitted.release(); await bridge.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GPG source digest mismatch and two Agent kinds refuse before creating any payload
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `gpgBridge`, `assert.rejects`, `f.scopes.admitTask`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-run' }, new AbortController().signal, { gpgAgent: { brid…`; `assert.equal(f.calls.includes('payload'), false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('GPG source digest mismatch and two Agent kinds refuse before creating any payload', async () => {
  const f = await fixture(), bridge = gpgBridge(), agent = new OwnedForwardAgent('unit-unused', new AbortController().signal);
  try {
    await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-run' }, new AbortController().signal,
      { gpgAgent: { bridge, resource: { ...gpgResource(), hostSourceSha256: 'f'.repeat(64) } } }),
      { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal(f.calls.includes('payload'), false);
    f.calls.length = 0;
    await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-run' }, new AbortController().signal,
      { gpgAgent: { bridge, resource: gpgResource() }, sshAgent: { agent, resource: agentResource() } }),
      { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.deepEqual(f.calls, []);
  } finally { await bridge.close(); await agent.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GPG prepared resources must be cleaned even when no native execution ticket was issued
 * 协作入口 / Collaborators: `fixture`, `gpgBridge`, `f.scopes.admitTask`, `gpgResource`.
 * 检查边界 / Checked boundaries: `assert.ok(f.calls.includes('gpg-cleanup'))`; `assert.equal(f.calls.includes('stop'), false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('GPG prepared resources must be cleaned even when no native execution ticket was issued', async () => {
  const f = await fixture(undefined, async context => {
    assert.equal(context.identity.identityId, f.identity.identityId); f.calls.push('gpg-cleanup');
  }), bridge = gpgBridge();
  const admitted = await f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-run' }, new AbortController().signal,
    { gpgAgent: { resource: gpgResource(), bridge } });
  f.setMissing(true); admitted.release();
  try {
    await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.ok(f.calls.includes('gpg-cleanup')); assert.equal(f.calls.includes('stop'), false);
    assert.equal((await f.view()).runs[0].run, null); assert.equal((await f.view()).runs[0].phase, 'closed');
  } finally { await bridge.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: changed GPG resource metadata cannot claim a currently active task owner
 * 状态影响 / State effects: `changed.runs[0].gpgAgent.hostHelperSha256`, `admitted.gpgContext!.resource.hostHelperSha256`, `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `gpgBridge`, `f.scopes.admitTask`, `gpgResource`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal(f.calls.includes('stop'), false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('changed GPG resource metadata cannot claim a currently active task owner', async () => {
  const f = await fixture(), bridge = gpgBridge();
  const admitted = await f.scopes.admitTask(f.vmId, f.project, { command: 'active' }, new AbortController().signal,
    { gpgAgent: { resource: gpgResource(), bridge } }); f.setAbsent(false);
  try {
    const original = await f.view(), changed = structuredClone(original);
    changed.runs[0].gpgAgent.hostHelperSha256 = 'f'.repeat(64);
    admitted.gpgContext!.resource.hostHelperSha256 = changed.runs[0].gpgAgent.hostHelperSha256;
    await writeFile(f.file, JSON.stringify(changed));
    await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    assert.equal(f.calls.includes('stop'), false);
    await writeFile(f.file, JSON.stringify(original)); f.calls.length = 0;
    await f.reopened().recoverStoppedTasks(f.vmId, 'default'); assert.deepEqual(f.calls, []);
  } finally { admitted.release(); await bridge.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a failed durable host admission cannot leave a GPG project intent without a host receipt
 * 状态影响 / State effects: `bridge.prepareAdmission`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `gpgBridge`, `assert.rejects`, `f.scopes.admitTask`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'private-frame-value' }, new AbortController().signal, { gpgAgent:…`; `assert.equal(preparations, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a failed durable host admission cannot leave a GPG project intent without a host receipt', async () => {
  const f = await fixture(), bridge = gpgBridge(); let preparations = 0;
  bridge.prepareAdmission = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: a failed durable host admission cannot leave a GPG project intent without a host receipt
   * 失败 / Failure: `new AppError('owned host receipt write failed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => {
    ++preparations; throw new AppError('owned host receipt write failed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  };
  try {
    await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'private-frame-value' },
      new AbortController().signal, { gpgAgent: { resource: gpgResource(), bridge } }),
      { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    assert.equal(preparations, 1); assert.deepEqual((await f.view()).runs, []);
    assert.equal(f.calls.includes('run'), false); await f.scopes.guard(f.vmId, 'default');
  } finally { await bridge.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the GPG host admission is persisted before a later guest boot guard can fail
 * 状态影响 / State effects: `bridge.prepareAdmission`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `gpgBridge`, `assert.rejects`, `f.scopes.admitTask`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-run' }, new AbortController().signal, { gpgAgent: { reso…`; `assert.equal(prepared, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('the GPG host admission is persisted before a later guest boot guard can fail', async () => {
  const f = await fixture(), bridge = gpgBridge(); let prepared = false;
  bridge.prepareAdmission = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: context; live。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: the GPG host admission is persisted before a later guest boot guard can fail
   * 状态影响 / State effects: `prepared`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `assert.deepEqual`, `f.view`, `bridge.bind`, `f.setBoot`.
   * 检查边界 / Checked boundaries: `assert.deepEqual((await f.view()).runs, [])`.
   */
  async (context, live) => {
    assert.deepEqual((await f.view()).runs, []);
    bridge.bind(context, live); prepared = true; f.setBoot(randomUUID());
  };
  try {
    await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-run' },
      new AbortController().signal, { gpgAgent: { resource: gpgResource(), bridge } }),
      { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal(prepared, true);
    const journal = await f.view(); assert.equal(journal.runs.length, 1);
    assert.equal(journal.runs[0].phase, 'intent'); assert.equal(journal.runs[0].run, null);
    assert.equal(f.calls.includes('run'), false);
  } finally { await bridge.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a bundle handoff pinned to an earlier guest boot cannot admit project code
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.scopes.admitTask`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-checkout-old-bundle' }, new AbortController().signal, { …`; `assert.equal(f.calls.includes('run'), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a bundle handoff pinned to an earlier guest boot cannot admit project code', async () => {
  const f = await fixture();
  await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-checkout-old-bundle' },
    new AbortController().signal, { expectedBootId: randomUUID() }), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(f.calls.includes('run'), false);
  await assert.rejects(f.view(), { code: 'ENOENT' });
});

type ScopeFixture = Awaited<ReturnType<typeof fixture>>;
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: f: ScopeFixture; cgroupName = 'openrc.sakura-ssh-default'。
 * 结果：返回分支计算值（`({ ...f.owner, kind: 'ssh' as const, cgroupName })`）。
 * Result: Return the branch-computed value (`({ ...f.owner, kind: 'ssh' as const, cgroupName })`).
 */
const sshOwner = (f: ScopeFixture, cgroupName = 'openrc.sakura-ssh-default') =>
  ({ ...f.owner, kind: 'ssh' as const, cgroupName });
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: owner: ReturnType<typeof sshOwner>。
 * 结果：返回分支计算值（`({ pid: 321, startTicks: '91', bootId: owner.bootId, cgroupName: owner.cgroupNam…`）。
 * Result: Return the branch-computed value (`({ pid: 321, startTicks: '91', bootId: owner.bootId, cgroupName: owner.cgroupNam…`).
 */
const sshDaemon = (owner: ReturnType<typeof sshOwner>): ProjectIdentitySshDaemon =>
  ({ pid: 321, startTicks: '91', bootId: owner.bootId, cgroupName: owner.cgroupName });
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: cgroupName = 'openrc.sakura-ssh-default'。
 * 结果：返回受控对象，公开字段包括 `sshOwner, daemon, begun, issued`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `sshOwner, daemon, begun, issued`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `fixture`, `sshOwner`, `sshDaemon`, `f.scopes.beginSsh`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function issuedSshFixture(cgroupName = 'openrc.sakura-ssh-default') {
  const f = await fixture(), owner = sshOwner(f, cgroupName), daemon = sshDaemon(owner);
  const begun = await f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, { TOKEN: 'private-ssh-environment' });
  const issued = await f.scopes.activateSsh(f.vmId, 'default', owner.runId, daemon);
  return { ...f, sshOwner: owner, daemon, begun, issued };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH host intent is durable before native preparation and contains the exact owner and digest without environment bodies
 * 状态影响 / State effects: `f.calls.length`, `f.core.prepareSsh`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sshOwner`, `sshDaemon`, `f.scopes.beginSsh`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(entry, { version: 1, projectId: 'default', identity: f.identity, runId: owner.runId, owner, sha256: begun.snapsho…`; `assert.equal(begun.snapshot.sha256, createHash('sha256').update(begun.snapshot.input).digest('hex'))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH host intent is durable before native preparation and contains the exact owner and digest without environment bodies', async () => {
  const f = await fixture(), owner = sshOwner(f), daemon = sshDaemon(owner);
  const begun = await f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner,
    { TOKEN: 'private-ssh-environment-雪', BASH_ENV: 'private-ssh-init;$(id)' });
  const entry = (await f.view()).runs[0], bytes = await readFile(f.file, 'utf8');
  assert.deepEqual(entry, { version: 1, projectId: 'default', identity: f.identity,
    runId: owner.runId, owner, sha256: begun.snapshot.sha256, phase: 'intent', run: null });
  assert.equal(begun.snapshot.sha256, createHash('sha256').update(begun.snapshot.input).digest('hex'));
  assert.ok(begun.snapshot.input.includes(Buffer.from('private-ssh-environment-雪')));
  assert.ok(!bytes.includes('private-ssh-')); assert.ok(!begun.snapshot.command.includes('private-ssh-'));
  assert.equal(f.calls.includes('ssh-prepare'), false); assert.equal(f.calls.includes('run'), false);
  f.calls.length = 0;
  assert.deepEqual(await f.reopened().sshRuns(f.vmId, 'default'), [{ runId: owner.runId, owner,
    identity: f.identity, sha256: entry.sha256, phase: 'intent', run: null }]);
  await assert.rejects(f.reopened().sshRun(f.vmId, 'default', owner.runId), { code: 'PROJECT_IDENTITY_RUN_STALE' });
  assert.equal(f.calls.length, 0); assert.equal(await readFile(f.file, 'utf8'), bytes);
  const prepare = f.core.prepareSsh;
  f.core.prepareSsh = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`prepare(...args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`prepare(...args)`) through a Promise.
   * 验证场景 / Scenario: SSH host intent is durable before native preparation and contains the exact owner and digest without environment bodies
   * 协作入口 / Collaborators: `assert.equal`, `readFile`, `assert.deepEqual`, `prepare`.
   * 检查边界 / Checked boundaries: `assert.equal(await readFile(f.file, 'utf8'), bytes, 'the durable intent predates the native prepare call')`; `assert.deepEqual(args[1], f.identity)`.
   */
  async (...args) => {
    assert.equal(await readFile(f.file, 'utf8'), bytes, 'the durable intent predates the native prepare call');
    assert.deepEqual(args[1], f.identity);
    assert.deepEqual(args[2], { runId: owner.runId, daemon, snapshotSha256: entry.sha256 });
    return prepare(...args);
  };
  const active = await f.reopened().activateSsh(f.vmId, 'default', owner.runId, daemon);
  assert.deepEqual((await f.view()).runs[0], { ...entry, phase: 'active', run: active.run });
  assert.deepEqual(f.calls, ['ssh-prepare']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH owner validation refuses another project, run, owner kind or traversal before issuing any snapshot or identity
 * 协作入口 / Collaborators: `fixture`, `sshOwner`, `assert.rejects`, `f.scopes.beginSsh`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, { TOKEN: 'must-not-persist' }), { code: 'PROJECT_IDENTITY_…`; `assert.deepEqual(f.calls, [])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH owner validation refuses another project, run, owner kind or traversal before issuing any snapshot or identity', async () => {
  for (const cgroupName of ['openrc.sakura-ssh-0123456789abcdef', 'system.slice/sakura-ssh-0123456789abcdef.service']) {
    const f = await fixture(), owner = sshOwner(f, cgroupName);
    await assert.rejects(f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, { TOKEN: 'must-not-persist' }),
      { code: 'PROJECT_IDENTITY_RUN_STALE' });
    assert.deepEqual(f.calls, []); await assert.rejects(f.view(), { code: 'ENOENT' });
  }
  for (const cgroupName of ['openrc.sakura-ssh-default/child', 'system.slice/../openrc.sakura-ssh-default',
    '/system.slice/sakura-ssh-default.service', 'system.slice//sakura-ssh-default.service']) {
    const f = await fixture(), owner = sshOwner(f, cgroupName);
    await assert.rejects(f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, {}));
    assert.deepEqual(f.calls, []); await assert.rejects(f.view(), { code: 'ENOENT' });
  }
  const f = await fixture(), owner = sshOwner(f);
  await assert.rejects(f.scopes.beginSsh(f.vmId, f.project, randomUUID(), owner, {}), { code: 'PROJECT_IDENTITY_RUN_STALE' });
  await assert.rejects(f.scopes.beginSsh(f.vmId, f.project, f.owner.runId, f.owner, {}), { code: 'PROJECT_IDENTITY_RUN_STALE' });
  assert.deepEqual(f.calls, []); await assert.rejects(f.view(), { code: 'ENOENT' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH snapshot digest or run substitution and a changed live instance cannot become a host intent
 * 状态影响 / State effects: `f.core.sshSnapshotInput`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sshOwner`, `assert.rejects`, `f.scopes.beginSsh`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, { TOKEN: 'private-ssh-environment' }), { code: 'PROJECT_ID…`; `assert.deepEqual((await f.view()).runs, [])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH snapshot digest or run substitution and a changed live instance cannot become a host intent', async () => {
  for (const change of ['digest', 'run', 'live', 'boot']) {
    const f = await fixture(), owner = sshOwner(f), snapshot = f.core.sshSnapshotInput;
    f.core.sshSnapshotInput = /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: args。
     * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
     * 验证场景 / Scenario: SSH snapshot digest or run substitution and a changed live instance cannot become a host intent
     * 协作入口 / Collaborators: `snapshot`, `f.machines.live.set`, `f.setBoot`, `randomUUID`.
     */
    async (...args) => {
      const result = await snapshot(...args);
      if (change === 'live') f.machines.live.set(f.vmId, {} as never);
      if (change === 'boot') f.setBoot(randomUUID());
      return { ...result, ...(change === 'digest' ? { sha256: 'f'.repeat(64) } : {}),
        ...(change === 'run' ? { runId: randomUUID() } : {}) };
    };
    await assert.rejects(f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, { TOKEN: 'private-ssh-environment' }),
      { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.deepEqual((await f.view()).runs, []); assert.equal(f.calls.includes('ssh-prepare'), false);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH activation preserves its original intent on daemon mismatch, lost acknowledgement and changed receipt ownership
 * 状态影响 / State effects: `f.calls.length`, `f.core.prepareSsh`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sshOwner`, `sshDaemon`, `f.scopes.beginSsh`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().activateSsh(f.vmId, 'default', owner.runId, changed), { code: 'PROJECT_IDENTITY_RUN_STALE' })`; `assert.equal(await readFile(f.file, 'utf8'), bytes)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH activation preserves its original intent on daemon mismatch, lost acknowledgement and changed receipt ownership', async () => {
  const f = await fixture(), owner = sshOwner(f), daemon = sshDaemon(owner);
  await f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, {});
  const bytes = await readFile(f.file, 'utf8'); f.calls.length = 0;
  for (const changed of [{ ...daemon, bootId: randomUUID() },
    { ...daemon, cgroupName: 'system.slice/sakura-ssh-default.service' },
    { ...daemon, cgroupName: 'openrc.sakura-ssh-0123456789abcdef' }]) {
    await assert.rejects(f.reopened().activateSsh(f.vmId, 'default', owner.runId, changed),
      { code: 'PROJECT_IDENTITY_RUN_STALE' });
    assert.equal(await readFile(f.file, 'utf8'), bytes);
  }
  assert.equal(f.calls.length, 0);
  f.core.prepareSsh = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: SSH activation preserves its original intent on daemon mismatch, lost acknowledgement and changed receipt ownership
   * 失败 / Failure: `new Error('owned SSH prepare acknowledgement lost')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `f.calls.push`.
   */
  async () => { f.calls.push('ssh-prepare'); throw new Error('owned SSH prepare acknowledgement lost'); };
  await assert.rejects(f.reopened().activateSsh(f.vmId, 'default', owner.runId, daemon), /owned SSH prepare acknowledgement lost/);
  assert.equal(await readFile(f.file, 'utf8'), bytes);
  const original: ProjectIdentityRun = { ...f.run, mode: 'inherit-current', cgroupName: owner.cgroupName };
  const mutations: Partial<ProjectIdentityRun>[] = [{ phase: 'closed' }, { mode: 'independent' },
    { registryId: randomUUID() }, { identityId: randomUUID() }, { revision: 2 },
    { projectId: '0123456789abcdef' }, { runId: randomUUID() }, { bootId: randomUUID() },
    { cgroupName: 'system.slice/sakura-ssh-default.service' }];
  for (const mutation of mutations) {
    f.core.prepareSsh = /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ...original, ...mutation })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ...original, ...mutation })`) through a Promise.
     * 验证场景 / Scenario: SSH activation preserves its original intent on daemon mismatch, lost acknowledgement and changed receipt ownership
     */
    async () => ({ ...original, ...mutation });
    await assert.rejects(f.reopened().activateSsh(f.vmId, 'default', owner.runId, daemon),
      { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal(await readFile(f.file, 'utf8'), bytes);
  }
  f.core.prepareSsh = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`original`），以 Promise 交付。
   * Result: Return the branch-computed value (`original`) through a Promise.
   * 验证场景 / Scenario: SSH activation preserves its original intent on daemon mismatch, lost acknowledgement and changed receipt ownership
   * 协作入口 / Collaborators: `f.machines.live.set`.
   */
  async () => { f.machines.live.set(f.vmId, {} as never); return original; };
  await assert.rejects(f.reopened().activateSsh(f.vmId, 'default', owner.runId, daemon),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(await readFile(f.file, 'utf8'), bytes); assert.equal(f.calls.includes('stop'), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH reload uses only readonly native probes and pins every immutable field without advancing host phases
 * 状态影响 / State effects: `f.calls.length`, `f.core.ensure`, `f.core.prepareSsh`, `f.core.stop`, `f.core.runReadonly`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `issuedSshFixture`, `readFile`, `assert.deepEqual`, `f.reopened().sshRun`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await f.reopened().sshRun(f.vmId, 'default', f.sshOwner.runId), f.issued)`; `assert.deepEqual(f.calls, ['run-readonly'])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH reload uses only readonly native probes and pins every immutable field without advancing host phases', async () => {
  const f = await issuedSshFixture('system.slice/sakura-ssh-default.service');
  const bytes = await readFile(f.file, 'utf8'), original = { ...f.issued.run }; f.calls.length = 0;
  f.core.ensure = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: SSH reload uses only readonly native probes and pins every immutable field without advancing host phases
   * 协作入口 / Collaborators: `assert.fail`.
   * 检查边界 / Checked boundaries: `assert.fail('readonly SSH reload must not ensure or install identities')`.
   */
  async () => { assert.fail('readonly SSH reload must not ensure or install identities'); };
  f.core.prepareSsh = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: SSH reload uses only readonly native probes and pins every immutable field without advancing host phases
   * 协作入口 / Collaborators: `assert.fail`.
   * 检查边界 / Checked boundaries: `assert.fail('readonly SSH reload must not prepare another daemon receipt')`.
   */
  async () => { assert.fail('readonly SSH reload must not prepare another daemon receipt'); };
  f.core.stop = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: SSH reload uses only readonly native probes and pins every immutable field without advancing host phases
   * 协作入口 / Collaborators: `assert.fail`.
   * 检查边界 / Checked boundaries: `assert.fail('readonly SSH reload must not retire the original receipt')`.
   */
  async () => { assert.fail('readonly SSH reload must not retire the original receipt'); };
  assert.deepEqual(await f.reopened().sshRun(f.vmId, 'default', f.sshOwner.runId), f.issued);
  assert.deepEqual(f.calls, ['run-readonly']);
  assert.deepEqual(await f.reopened().sshRuns(f.vmId, 'default'), [{ runId: f.sshOwner.runId,
    owner: f.sshOwner, identity: f.identity, sha256: f.begun.snapshot.sha256, phase: 'active', run: original }]);
  const mutations: Partial<ProjectIdentityRun>[] = [{ phase: 'closed' }, { mode: 'independent' },
    { registryId: randomUUID() }, { identityId: randomUUID() }, { revision: 2 }, { projectId: '0123456789abcdef' },
    { runId: randomUUID() }, { bootId: randomUUID() }, { build: 'b'.repeat(64) },
    { networkDevice: '99' }, { networkInode: '99' }, { cgroupDevice: '99' }, { cgroupInode: '99' },
    { namespace: 'sk-default' }, { cgroupName: 'openrc.sakura-ssh-default' }];
  for (const mutation of mutations) {
    f.core.runReadonly = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
     * 验证场景 / Scenario: SSH reload uses only readonly native probes and pins every immutable field without advancing host phases
     * 协作入口 / Collaborators: `f.calls.push`.
     */
    async () => { f.calls.push('run-readonly'); return { ...original, ...mutation }; };
    await assert.rejects(f.reopened().sshRun(f.vmId, 'default', f.sshOwner.runId), { code: 'PROJECT_IDENTITY_RUN_STALE' });
    assert.equal(await readFile(f.file, 'utf8'), bytes);
  }
  f.core.runReadonly = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`original`），以 Promise 交付。
   * Result: Return the branch-computed value (`original`) through a Promise.
   * 验证场景 / Scenario: SSH reload uses only readonly native probes and pins every immutable field without advancing host phases
   * 协作入口 / Collaborators: `f.machines.live.set`.
   */
  async () => { f.machines.live.set(f.vmId, {} as never); return original; };
  await assert.rejects(f.reopened().sshRun(f.vmId, 'default', f.sshOwner.runId), { code: 'PROJECT_IDENTITY_RUN_STALE' });
  assert.equal(await readFile(f.file, 'utf8'), bytes);
  assert.ok(f.calls.every(call => call === 'run-readonly')); assert.deepEqual(f.confirmCommands, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH cannot replace an unresolved intent or active service with a new run and phase lists perform no guest work
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sshOwner`, `sshDaemon`, `f.scopes.beginSsh`.
 * 检查边界 / Checked boundaries: `assert.equal(entries.length, 1)`; `assert.equal(entries[0].phase, activate ? 'active' : 'intent')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH cannot replace an unresolved intent or active service with a new run and phase lists perform no guest work', async () => {
  for (const activate of [false, true]) {
    const f = await fixture(), owner = sshOwner(f), daemon = sshDaemon(owner);
    await f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, {});
    if (activate) await f.scopes.activateSsh(f.vmId, 'default', owner.runId, daemon);
    const bytes = await readFile(f.file, 'utf8'); f.calls.length = 0;
    const entries = await f.reopened().sshRuns(f.vmId, 'default');
    assert.equal(entries.length, 1); assert.equal(entries[0].phase, activate ? 'active' : 'intent');
    assert.equal(f.calls.length, 0);
    for (const runId of [owner.runId, randomUUID()])
      await assert.rejects(f.reopened().beginSsh(f.vmId, f.project, runId, { ...owner, runId }, {}),
        { code: 'PROJECT_IDENTITY_RUN_STALE' });
    assert.equal(f.calls.includes('ssh-snapshot'), false); assert.equal(f.calls.includes('ssh-prepare'), false);
    assert.equal(await readFile(f.file, 'utf8'), bytes);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH closure requires the entire original service cgroup gone before native ticket retirement
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `issuedSshFixture`, `readFile`, `f.setAbsent`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED'…`; `assert.deepEqual(f.calls, ['confirm'])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH closure requires the entire original service cgroup gone before native ticket retirement', async () => {
  for (const cgroupName of ['openrc.sakura-ssh-default', 'system.slice/sakura-ssh-default.service']) {
    const f = await issuedSshFixture(cgroupName), bytes = await readFile(f.file, 'utf8');
    f.calls.length = 0; f.setAbsent(false);
    await assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId),
      { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    assert.deepEqual(f.calls, ['confirm']); assert.equal(await readFile(f.file, 'utf8'), bytes);
    assert.ok(f.confirmCommands.every(command => command.includes('name=' + JSON.stringify(cgroupName)) &&
      command.includes('assert not os.path.lexists')));
    f.setAbsent(true); f.calls.length = 0;
    await f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId);
    assert.deepEqual(f.calls, ['confirm', 'run', 'confirm', 'stop']);
    const closed = (await f.view()).runs[0];
    assert.equal(closed.phase, 'closed'); assert.deepEqual(closed.run, { ...f.issued.run, phase: 'closed' });
    assert.deepEqual(await f.reopened().sshRuns(f.vmId, 'default'), []);
    await f.reopened().guard(f.vmId, 'default');
    f.calls.length = 0;
    await f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId);
    assert.deepEqual(f.calls, [], 'retiring the confirmed original SSH ticket is idempotent');
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH cleanup failure preserves an unissued intent and only exact RECORD_ABSENT after full domain removal can close it
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sshOwner`, `f.scopes.beginSsh`, `readFile`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', owner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal(await readFile(f.file, 'utf8'), bytes)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH cleanup failure preserves an unissued intent and only exact RECORD_ABSENT after full domain removal can close it', async () => {
  const f = await fixture(), owner = sshOwner(f);
  await f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, {});
  const bytes = await readFile(f.file, 'utf8'); f.setUnknown(true); f.calls.length = 0;
  await assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(f.file, 'utf8'), bytes); assert.equal(f.calls.includes('stop'), false);
  f.setUnknown(false); f.setMissing(true); f.setAbsent(false);
  await assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(f.file, 'utf8'), bytes);
  f.setAbsent(true); f.calls.length = 0;
  await f.reopened().closeAfterScopeStopped(f.vmId, 'default', owner.runId);
  assert.deepEqual(f.calls, ['confirm', 'run', 'confirm']);
  const closed = (await f.view()).runs[0]; assert.equal(closed.phase, 'closed'); assert.equal(closed.run, null);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH full receipts survive missing tickets, retargeted reads, failed stops and mismatched stop receipts for exact recovery
 * 状态影响 / State effects: `f.calls.length`, `f.core.run`, `f.core.stop`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `issuedSshFixture`, `readFile`, `f.setMissing`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED'…`; `assert.equal(await readFile(f.file, 'utf8'), bytes)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH full receipts survive missing tickets, retargeted reads, failed stops and mismatched stop receipts for exact recovery', async () => {
  const f = await issuedSshFixture(), bytes = await readFile(f.file, 'utf8'), run = { ...f.issued.run };
  f.calls.length = 0; f.setMissing(true);
  await assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(f.file, 'utf8'), bytes); assert.equal(f.calls.includes('stop'), false);
  f.setMissing(false); const readRun = f.core.run;
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...run, cgroupInode: '99' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...run, cgroupInode: '99' })`) through a Promise.
   * 验证场景 / Scenario: SSH full receipts survive missing tickets, retargeted reads, failed stops and mismatched stop receipts for exact recovery
   */
  async () => ({ ...run, cgroupInode: '99' });
  await assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(f.file, 'utf8'), bytes); f.core.run = readRun;
  f.setCleanupFail(true);
  await assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(f.file, 'utf8'), bytes);
  const stop = f.core.stop; f.setCleanupFail(false);
  f.core.stop = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...run, phase: 'closed', networkInode: '99' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...run, phase: 'closed', networkInode: '99' })`) through a Promise.
   * 验证场景 / Scenario: SSH full receipts survive missing tickets, retargeted reads, failed stops and mismatched stop receipts for exact recovery
   */
  async () => ({ ...run, phase: 'closed', networkInode: '99' });
  await assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(f.file, 'utf8'), bytes);
  f.core.stop = stop;
  await f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId);
  assert.deepEqual((await f.view()).runs[0].run, { ...run, phase: 'closed' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH old-boot intent and active receipts retire with their original ticket unchanged and never invoke native stop
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sshOwner`, `sshDaemon`, `f.scopes.beginSsh`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(f.calls, ['confirm', 'confirm'])`; `assert.deepEqual(retired, { ...original, phase: 'closed', retirement: { reason: 'guest-reboot', bootId } })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH old-boot intent and active receipts retire with their original ticket unchanged and never invoke native stop', async () => {
  for (const activate of [false, true]) {
    const f = await fixture(), owner = sshOwner(f), daemon = sshDaemon(owner);
    await f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, {});
    if (activate) await f.scopes.activateSsh(f.vmId, 'default', owner.runId, daemon);
    const original = (await f.view()).runs[0], bootId = randomUUID();
    f.setBoot(bootId); f.setMissing(true); f.calls.length = 0;
    await f.reopened().closeAfterScopeStopped(f.vmId, 'default', owner.runId);
    assert.deepEqual(f.calls, ['confirm', 'confirm']);
    const retired = (await f.view()).runs[0];
    assert.deepEqual(retired, { ...original, phase: 'closed', retirement: { reason: 'guest-reboot', bootId } });
    assert.deepEqual(await f.reopened().sshRuns(f.vmId, 'default'), []);
    await f.reopened().guard(f.vmId, 'default');
    await assert.rejects(f.reopened().sshRun(f.vmId, 'default', owner.runId), { code: 'PROJECT_IDENTITY_RUN_STALE' });
    await assert.rejects(f.reopened().beginSsh(f.vmId, f.project, owner.runId, { ...owner, bootId }, {}),
      { code: 'PROJECT_IDENTITY_RUN_STALE' });
    assert.equal(f.calls.includes('run'), false); assert.equal(f.calls.includes('stop'), false);
    assert.equal(f.calls.includes('ssh-prepare'), false);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH reboot retirement refuses a recreated original cgroup or an unstable current boot while retaining the full receipt
 * 状态影响 / State effects: `f.calls.length`, `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `issuedSshFixture`, `readFile`, `f.setBoot`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED'…`; `assert.equal(await readFile(f.file, 'utf8'), bytes)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH reboot retirement refuses a recreated original cgroup or an unstable current boot while retaining the full receipt', async () => {
  const f = await issuedSshFixture('system.slice/sakura-ssh-default.service');
  const bytes = await readFile(f.file, 'utf8'); f.setBoot(randomUUID()); f.setAbsent(false); f.calls.length = 0;
  await assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(f.file, 'utf8'), bytes);
  f.setAbsent(true); const exec = f.machines.exec;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: SSH reboot retirement refuses a recreated original cgroup or an unstable current boot while retaining the full receipt
   * 协作入口 / Collaborators: `exec`, `f.setBoot`, `randomUUID`.
   */
  async (...args) => { const result = await exec(...args); f.setBoot(randomUUID()); return result; };
  await assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(f.file, 'utf8'), bytes);
  assert.equal(f.calls.includes('run'), false); assert.equal(f.calls.includes('stop'), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH recovery pins a lost activation acknowledgement before stop and readonly state still refuses the unresolved intent
 * 状态影响 / State effects: `f.core.prepareSsh`, `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sshOwner`, `sshDaemon`, `f.scopes.beginSsh`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes.activateSsh(f.vmId, 'default', owner.runId, daemon), /owned activation acknowledgement lost/)`; `assert.equal(intent.phase, 'intent')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH recovery pins a lost activation acknowledgement before stop and readonly state still refuses the unresolved intent', async () => {
  for (const cgroupName of ['openrc.sakura-ssh-default', 'system.slice/sakura-ssh-default.service']) {
    const f = await fixture(), owner = sshOwner(f, cgroupName), daemon = sshDaemon(owner);
    const begun = await f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, { TOKEN: 'private-ssh-recovery-token' });
    const prepare = f.core.prepareSsh;
    f.core.prepareSsh = /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: args。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: SSH recovery pins a lost activation acknowledgement before stop and readonly state still refuses the unresolved intent
     * 失败 / Failure: `new Error('owned activation acknowledgement lost after native issuance')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `prepare`.
     */
    async (...args) => {
      await prepare(...args); throw new Error('owned activation acknowledgement lost after native issuance');
    };
    await assert.rejects(f.scopes.activateSsh(f.vmId, 'default', owner.runId, daemon), /owned activation acknowledgement lost/);
    const bytes = await readFile(f.file, 'utf8'), intent = (await f.view()).runs[0];
    assert.equal(intent.phase, 'intent'); assert.equal(intent.run, null);
    f.calls.length = 0;
    await assert.rejects(f.reopened().sshRun(f.vmId, 'default', owner.runId), { code: 'PROJECT_IDENTITY_RUN_STALE' });
    assert.equal(f.calls.length, 0); assert.equal(await readFile(f.file, 'utf8'), bytes);
    f.core.prepareSsh = /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: SSH recovery pins a lost activation acknowledgement before stop and readonly state still refuses the unresolved intent
     * 协作入口 / Collaborators: `assert.fail`.
     * 检查边界 / Checked boundaries: `assert.fail('recovery must not prepare a second SSH ticket')`.
     */
    async () => { assert.fail('recovery must not prepare a second SSH ticket'); };
    const recovered = await f.reopened().recoverSshTicket(f.vmId, 'default', owner.runId);
    assert.deepEqual(recovered, { runId: owner.runId, owner, identity: f.identity,
      sha256: begun.snapshot.sha256, run: f.run, phase: 'active' });
    assert.deepEqual(f.calls, ['run']);
    assert.deepEqual((await f.view()).runs[0], { ...intent, phase: 'active', run: f.run });
    assert.ok(!(await readFile(f.file, 'utf8')).includes('private-ssh-recovery-token'));
    assert.deepEqual(await f.reopened().sshRuns(f.vmId, 'default'), [recovered]);
    await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
    assert.deepEqual((await f.reopened().sshRun(f.vmId, 'default', owner.runId)).run, f.run);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH recovery validates the full schema and original owner before pinning any unacknowledged native receipt
 * 状态影响 / State effects: `f.core.run`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sshOwner`, `sshDaemon`, `f.scopes.beginSsh`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' })`; `assert.equal(await readFile(f.file, 'utf8'), bytes)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH recovery validates the full schema and original owner before pinning any unacknowledged native receipt', async () => {
  const f = await fixture(), owner = sshOwner(f), daemon = sshDaemon(owner);
  await f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, {});
  await f.core.prepareSsh(f.vmId, f.identity, { runId: owner.runId, daemon, snapshotSha256: 'a'.repeat(64) });
  const bytes = await readFile(f.file, 'utf8'), run = { ...f.run };
  const mutations: Partial<ProjectIdentityRun>[] = [{ mode: 'independent', cgroupName: 'sakura-identity-' + owner.runId },
    { registryId: randomUUID() }, { identityId: randomUUID() }, { revision: 2 }, { runId: randomUUID() },
    { bootId: randomUUID() }, { cgroupName: 'system.slice/sakura-ssh-default.service' },
    { projectId: '0123456789abcdef', cgroupName: 'openrc.sakura-ssh-0123456789abcdef' },
    { namespace: 'sk-default' }, { networkInode: '0' }, { cgroupInode: '0' }];
  for (const mutation of mutations) {
    f.core.run = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ...run, ...mutation })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ...run, ...mutation })`) through a Promise.
     * 验证场景 / Scenario: SSH recovery validates the full schema and original owner before pinning any unacknowledged native receipt
     */
    async () => ({ ...run, ...mutation });
    await assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', owner.runId),
      { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal(await readFile(f.file, 'utf8'), bytes);
  }
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`incomplete as ProjectIdentityRun`），以 Promise 交付。
   * Result: Return the branch-computed value (`incomplete as ProjectIdentityRun`) through a Promise.
   * 验证场景 / Scenario: SSH recovery validates the full schema and original owner before pinning any unacknowledged native receipt
   */
  async () => { const { cgroupDevice: _discard, ...incomplete } = run; return incomplete as ProjectIdentityRun; };
  await assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(await readFile(f.file, 'utf8'), bytes);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH recovery preserves every pinned immutable inode, boot, run and build and never downgrades a full receipt to absence
 * 状态影响 / State effects: `f.core.run`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `issuedSshFixture`, `readFile`, `randomUUID`, `'b'.repeat`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', f.sshOwner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' })`; `assert.equal(await readFile(f.file, 'utf8'), bytes)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH recovery preserves every pinned immutable inode, boot, run and build and never downgrades a full receipt to absence', async () => {
  const f = await issuedSshFixture(), bytes = await readFile(f.file, 'utf8'), run = { ...f.issued.run };
  const mutations: Partial<ProjectIdentityRun>[] = [{ registryId: randomUUID() }, { identityId: randomUUID() },
    { revision: 2 }, { runId: randomUUID() }, { bootId: randomUUID() }, { build: 'b'.repeat(64) },
    { networkDevice: '99' }, { networkInode: '99' }, { cgroupDevice: '99' }, { cgroupInode: '99' },
    { cgroupName: 'system.slice/sakura-ssh-default.service' }, { namespace: 'sk-default' }];
  for (const mutation of mutations) {
    f.core.run = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ...run, ...mutation })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ...run, ...mutation })`) through a Promise.
     * 验证场景 / Scenario: SSH recovery preserves every pinned immutable inode, boot, run and build and never downgrades a full receipt to absence
     */
    async () => ({ ...run, ...mutation });
    await assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', f.sshOwner.runId),
      { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal(await readFile(f.file, 'utf8'), bytes);
  }
  const missing = new AppError('owned complete ticket disappeared', 409, 'PROJECT_IDENTITY_RECORD_ABSENT');
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: SSH recovery preserves every pinned immutable inode, boot, run and build and never downgrades a full receipt to absence
   * 失败 / Failure: `missing`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw missing; };
  await assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', f.sshOwner.runId), error => error === missing);
  assert.equal(await readFile(f.file, 'utf8'), bytes);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH recovery accepts only exact RECORD_ABSENT for an originally unissued intent and preserves all other query errors
 * 状态影响 / State effects: `f.calls.length`, `f.core.run`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sshOwner`, `f.scopes.beginSsh`, `readFile`.
 * 检查边界 / Checked boundaries: `assert.equal(await f.reopened().recoverSshTicket(f.vmId, 'default', owner.runId), null)`; `assert.deepEqual(f.calls, ['run'])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH recovery accepts only exact RECORD_ABSENT for an originally unissued intent and preserves all other query errors', async () => {
  const f = await fixture(), owner = sshOwner(f);
  await f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, {});
  const bytes = await readFile(f.file, 'utf8'); f.setMissing(true); f.calls.length = 0;
  assert.equal(await f.reopened().recoverSshTicket(f.vmId, 'default', owner.runId), null);
  assert.deepEqual(f.calls, ['run']); assert.equal(await readFile(f.file, 'utf8'), bytes);
  await assert.rejects(f.reopened().sshRun(f.vmId, 'default', owner.runId), { code: 'PROJECT_IDENTITY_RUN_STALE' });
  const failures = [new AppError('owned lost native query', 502, 'PROJECT_IDENTITY_CONTROL_FAILED'),
    new AppError('owned malformed native record', 409, 'PROJECT_IDENTITY_RECORD_SIZE'), new Error('owned transport failure'),
    new Error('PROJECT_IDENTITY_RECORD_ABSENT')];
  for (const failure of failures) {
    f.core.run = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: SSH recovery accepts only exact RECORD_ABSENT for an originally unissued intent and preserves all other query errors
     * 失败 / Failure: `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    async () => { throw failure; };
    await assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', owner.runId), error => error === failure);
    assert.equal(await readFile(f.file, 'utf8'), bytes);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH closed native recovery remains a guarded host run until its whole original cgroup is stopped
 * 状态影响 / State effects: `f.core.run`, `f.core.runReadonly`, `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `issuedSshFixture`, `f.view`, `f.reopened().recoverSshTicket`, `f.reopened`.
 * 检查边界 / Checked boundaries: `assert.equal(recovered?.phase, 'active')`; `assert.deepEqual(recovered?.run, closed)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH closed native recovery remains a guarded host run until its whole original cgroup is stopped', async () => {
  const f = await issuedSshFixture('system.slice/sakura-ssh-default.service'), original = (await f.view()).runs[0];
  const closed: ProjectIdentityRun = { ...f.issued.run, phase: 'closed' };
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`closed`），以 Promise 交付。
   * Result: Return the branch-computed value (`closed`) through a Promise.
   * 验证场景 / Scenario: SSH closed native recovery remains a guarded host run until its whole original cgroup is stopped
   * 协作入口 / Collaborators: `f.calls.push`.
   */
  async () => { f.calls.push('run'); return closed; };
  const recovered = await f.reopened().recoverSshTicket(f.vmId, 'default', f.sshOwner.runId);
  assert.equal(recovered?.phase, 'active'); assert.deepEqual(recovered?.run, closed);
  assert.deepEqual((await f.view()).runs[0], { ...original, run: closed, phase: 'active' });
  await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  f.core.runReadonly = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`closed`），以 Promise 交付。
   * Result: Return the branch-computed value (`closed`) through a Promise.
   * 验证场景 / Scenario: SSH closed native recovery remains a guarded host run until its whole original cgroup is stopped
   */
  async () => closed;
  await assert.rejects(f.reopened().sshRun(f.vmId, 'default', f.sshOwner.runId), { code: 'PROJECT_IDENTITY_RUN_STALE' });
  const bytes = await readFile(f.file, 'utf8');
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...closed, phase: 'active' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...closed, phase: 'active' })`) through a Promise.
   * 验证场景 / Scenario: SSH closed native recovery remains a guarded host run until its whole original cgroup is stopped
   */
  async () => ({ ...closed, phase: 'active' });
  await assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', f.sshOwner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(await readFile(f.file, 'utf8'), bytes);
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`closed`），以 Promise 交付。
   * Result: Return the branch-computed value (`closed`) through a Promise.
   * 验证场景 / Scenario: SSH closed native recovery remains a guarded host run until its whole original cgroup is stopped
   * 协作入口 / Collaborators: `f.calls.push`.
   */
  async () => { f.calls.push('run'); return closed; }; f.setAbsent(false); f.calls.length = 0;
  await assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(f.file, 'utf8'), bytes); assert.deepEqual(f.calls, ['confirm']);
  f.setAbsent(true); f.calls.length = 0;
  await f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.sshOwner.runId);
  assert.deepEqual(f.calls, ['confirm', 'run']); assert.equal((await f.view()).runs[0].phase, 'closed');
  assert.equal(f.calls.includes('stop'), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH closed native recovery pins a previously unissued intent without falsely retiring its host domain
 * 状态影响 / State effects: `f.run.phase`, `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sshOwner`, `sshDaemon`, `f.scopes.beginSsh`.
 * 检查边界 / Checked boundaries: `assert.equal(recovered?.phase, 'active')`; `assert.deepEqual(recovered?.run, f.run)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH closed native recovery pins a previously unissued intent without falsely retiring its host domain', async () => {
  const f = await fixture(), owner = sshOwner(f), daemon = sshDaemon(owner);
  await f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, {});
  await f.core.prepareSsh(f.vmId, f.identity, { runId: owner.runId, daemon, snapshotSha256: 'a'.repeat(64) });
  f.run.phase = 'closed'; f.calls.length = 0;
  const recovered = await f.reopened().recoverSshTicket(f.vmId, 'default', owner.runId);
  assert.equal(recovered?.phase, 'active'); assert.deepEqual(recovered?.run, f.run);
  assert.deepEqual(f.calls, ['run']);
  await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  f.setMissing(true); const bytes = await readFile(f.file, 'utf8');
  await assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', owner.runId), { code: 'PROJECT_IDENTITY_RECORD_ABSENT' });
  assert.equal(await readFile(f.file, 'utf8'), bytes);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH recovery refuses cold-boot queries and leaves old intent or full tickets to the existing reboot retirement path
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sshOwner`, `sshDaemon`, `f.scopes.beginSsh`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', owner.runId), { code: 'PROJECT_IDENTITY_RUN_STALE' })`; `assert.equal(await readFile(f.file, 'utf8'), bytes)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH recovery refuses cold-boot queries and leaves old intent or full tickets to the existing reboot retirement path', async () => {
  for (const activate of [false, true]) {
    const f = await fixture(), owner = sshOwner(f), daemon = sshDaemon(owner);
    await f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, {});
    if (activate) await f.scopes.activateSsh(f.vmId, 'default', owner.runId, daemon);
    const bytes = await readFile(f.file, 'utf8'), original = (await f.view()).runs[0], bootId = randomUUID();
    f.setBoot(bootId); f.calls.length = 0;
    await assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', owner.runId), { code: 'PROJECT_IDENTITY_RUN_STALE' });
    assert.equal(await readFile(f.file, 'utf8'), bytes); assert.equal(f.calls.length, 0);
    await f.reopened().closeAfterScopeStopped(f.vmId, 'default', owner.runId);
    assert.deepEqual(f.calls, ['confirm', 'confirm']);
    assert.deepEqual((await f.view()).runs[0], { ...original, phase: 'closed', retirement: { reason: 'guest-reboot', bootId } });
    f.calls.length = 0;
    await assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', owner.runId), { code: 'PROJECT_IDENTITY_RUN_STALE' });
    assert.equal(f.calls.length, 0);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH recovery rejects a changed live instance, boot or host metadata before pinning a query or accepting absence
 * 状态影响 / State effects: `f.core.run`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sshOwner`, `sshDaemon`, `f.scopes.beginSsh`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' })`; `assert.equal(await readFile(f.file, 'utf8'), expectedBytes)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH recovery rejects a changed live instance, boot or host metadata before pinning a query or accepting absence', async () => {
  for (const absent of [false, true]) for (const change of ['live', 'boot', 'host']) {
    const f = await fixture(), owner = sshOwner(f), daemon = sshDaemon(owner);
    await f.scopes.beginSsh(f.vmId, f.project, owner.runId, owner, {});
    await f.core.prepareSsh(f.vmId, f.identity, { runId: owner.runId, daemon, snapshotSha256: 'a'.repeat(64) });
    const bytes = await readFile(f.file, 'utf8'); let expectedBytes = bytes;
    f.core.run = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
     * 验证场景 / Scenario: SSH recovery rejects a changed live instance, boot or host metadata before pinning a query or accepting absence
     * 状态影响 / State effects: `journal.runs[0].sha256`, `expectedBytes`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new AppError('owned absent receipt', 409, 'PROJECT_IDENTITY_RECORD_ABSENT')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `f.machines.live.set`, `f.setBoot`, `randomUUID`, `f.view`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    async () => {
      if (change === 'live') f.machines.live.set(f.vmId, {} as never);
      if (change === 'boot') f.setBoot(randomUUID());
      if (change === 'host') {
        const journal = await f.view(); journal.runs[0].sha256 = 'b'.repeat(64);
        expectedBytes = JSON.stringify(journal); await writeFile(f.file, expectedBytes);
      }
      if (absent) throw new AppError('owned absent receipt', 409, 'PROJECT_IDENTITY_RECORD_ABSENT');
      return { ...f.run };
    };
    await assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal(await readFile(f.file, 'utf8'), expectedBytes);
    assert.equal((await f.view()).runs[0].run, null); assert.equal((await f.view()).runs[0].phase, 'intent');
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH recovery requires the original unresolved SSH entry and never adopts a task, missing UUID or closed host ticket
 * 状态影响 / State effects: `f.calls.length`, `g.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scopes.inherited`, `readFile`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', runId), { code: 'PROJECT_IDENTITY_RUN_STALE' })`; `assert.equal(await readFile(f.file, 'utf8'), bytes)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH recovery requires the original unresolved SSH entry and never adopts a task, missing UUID or closed host ticket', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  const bytes = await readFile(f.file, 'utf8'); f.calls.length = 0;
  for (const runId of [f.owner.runId, randomUUID()]) {
    await assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', runId), { code: 'PROJECT_IDENTITY_RUN_STALE' });
    assert.equal(await readFile(f.file, 'utf8'), bytes); assert.equal(f.calls.length, 0);
  }
  const g = await issuedSshFixture(); await g.scopes.closeAfterScopeStopped(g.vmId, 'default', g.sshOwner.runId);
  const closed = await readFile(g.file, 'utf8'); g.calls.length = 0;
  await assert.rejects(g.reopened().recoverSshTicket(g.vmId, 'default', g.sshOwner.runId), { code: 'PROJECT_IDENTITY_RUN_STALE' });
  assert.equal(await readFile(g.file, 'utf8'), closed); assert.equal(g.calls.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH recovery serializes manager instances under the project lock and honors cancellation before persistence
 * 状态影响 / State effects: `f.calls.length`, `f.core.run`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `issuedSshFixture`, `f.reopened().recoverSshTicket`, `f.reopened`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(queries, 1)`; `assert.deepEqual(a, b)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH recovery serializes manager instances under the project lock and honors cancellation before persistence', async () => {
  const f = await issuedSshFixture(); f.calls.length = 0;
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, proceed!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const firstQuery = new Promise<void>(resolve => { entered = resolve; });
  const releaseQuery = new Promise<void>(resolve => { proceed = resolve; });
  let queries = 0;
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
   * 验证场景 / Scenario: SSH recovery serializes manager instances under the project lock and honors cancellation before persistence
   * 协作入口 / Collaborators: `f.calls.push`, `entered`.
   */
  async () => {
    f.calls.push('run'); queries++;
    if (queries === 1) { entered(); await releaseQuery; }
    return { ...f.run };
  };
  const first = f.reopened().recoverSshTicket(f.vmId, 'default', f.sshOwner.runId);
  await firstQuery;
  const second = f.reopened().recoverSshTicket(f.vmId, 'default', f.sshOwner.runId);
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(queries, 1);
  proceed();
  const [a, b] = await Promise.all([first, second]); assert.deepEqual(a, b); assert.equal(queries, 2);
  const bytes = await readFile(f.file, 'utf8'), cancellation = new AbortController();
  f.core.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
   * 验证场景 / Scenario: SSH recovery serializes manager instances under the project lock and honors cancellation before persistence
   * 协作入口 / Collaborators: `cancellation.abort`.
   */
  async () => { cancellation.abort(new Error('owned recovery cancellation')); return { ...f.run }; };
  await assert.rejects(f.reopened().recoverSshTicket(f.vmId, 'default', f.sshOwner.runId, cancellation.signal),
    /owned recovery cancellation/);
  assert.equal(await readFile(f.file, 'utf8'), bytes); assert.equal(f.calls.includes('ssh-prepare'), false);
});
