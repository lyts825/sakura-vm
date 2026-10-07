/**
 * 模块职责：回归验证模块，围绕 `project-terminals` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-terminals`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: terminal leases bind to the selected project and block directory or network edits until disconnected; task preparation refuses a missing original directory without creating it or issuing a lease.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, realpath, access } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { quote } from '../server/files.ts';
import { tmpdir } from 'node:os';
import type { Machines as MachineType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-terminals-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Workspaces, projectVersion } = await import('../server/workspaces.ts');
const { ProjectTerminals, assertProjectTerminalsStopped } = await import('../server/project-terminals.ts');
const { ProjectRunScopes } = await import('../server/project-run-scope.ts');
const { ProjectIdentities, projectIdentitySchema, projectIdentityRunSchema } = await import('../server/project-identity.ts');
const { AppError } = await import('../server/model.ts');
const { vmDir } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `id, bootId, machines, commands, workspaces, terminals, options, identities, runs`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, bootId, machines, commands, workspaces, terminals, options, identities, runs`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `Object.assign`, `locks.locked.bind`, `mkdir`.
 */
async function fixture() {
  const id = randomUUID(), locks = new Machines({} as Engine, fakeVmNetwork);
  const commands: string[] = [];
  let status = 'running', persistent = false, verified = true;
  let migration: 'applying' | 'failed' | 'directory-applied' | 'invalid' | null = null;
  const identityId = randomUUID();
  const bootId = randomUUID(), registryId = randomUUID();
  const identities = new Map<string, ReturnType<typeof projectIdentitySchema.parse>>();
  const runs = new Map<string, ReturnType<typeof projectIdentityRunSchema.parse>>();
  const controlCalls: string[] = [];
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { template: 'none' }]]), live: new Map([[id, {}]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ template: 'none', distro: 'alpine' })`）。
     * Result: Return the branch-computed value (`({ template: 'none', distro: 'alpine' })`).
     */
    get: () => ({ template: 'none', distro: 'alpine' }), /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`status`）。
     * Result: Return the branch-computed value (`status`).
     */
    state: () => status,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    writeGuestFile: async () => {},
    locked: locks.locked.bind(locks),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `commands.push`, `command.match`, `JSON.parse`, `Buffer.from(encoded, 'base64').toString`.
     * 检查边界 / Checked boundaries: `assert.ok(['install', 'begin-network-release'].includes(request.action))`.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      const encoded = command.match(/\/controller\.py' '([A-Za-z0-9+/=]+)'$/)?.[1];
      if (encoded) {
        const request = JSON.parse(Buffer.from(encoded, 'base64').toString());
        assert.ok(['install', 'begin-network-release'].includes(request.action));
        return { code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result: request.action === 'install' ? {
          version: 1, build: command.match(/sakura-project-identity\/([a-f0-9]{64})/)![1], registryId, bootId,
        } : null }) };
      }
      if (command.includes('project-directory-migrations'))
        return { code: 0, stderr: '', stdout: JSON.stringify(migration === 'invalid' ? {} : migration ? {
          version: 1, projectId: 'default', planId: randomUUID(), sha256: 'a'.repeat(64), phase: migration,
          identity: { version: 1, phase: 'active', registryId: randomUUID(), projectId: 'default', identityId,
            revision: 1, uid: 20000, gid: 20000, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
            home: '/var/lib/sakura-project-homes/' + identityId, homeDevice: '1', homeInode: '2',
            directory: '/workspace', directoryDevice: '1', directoryInode: '3', networkIsolation: 'host' },
        } : null) };
      if (command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS'))
        return { stdout: 'absent\n', stderr: '', code: 0 };
      if (command.endsWith('/proc/sys/kernel/random/boot_id')) return { stdout: bootId, stderr: '', code: 0 };
      if (command.includes('absent'))
        return { stdout: JSON.stringify({ bootId, absent: true }), stderr: '', code: 0 };
      if (command.includes('sakura_panes=') && !verified)
        return { stdout: '', stderr: '终端窗格未处于项目网络空间', code: 1 };
      return { stdout: persistent && command.includes('echo active') ? 'active' : command.includes('sakura_panes=') ?
        'SAKURA_TERMINAL_ID=00000000-0000-4000-8000-000000000003\n' : '', stderr: '', code: 0 };
    },
  }) as unknown as MachineType;
  await mkdir(vmDir(id), { recursive: true });
  const workspaces = new Workspaces(machines);
  const core = {
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _vm: string; binding: { projectId: string; directory: string; networkIsolation: 'host' …。
     * 结果：返回分支计算值（`identity`），以 Promise 交付。
     * Result: Return the branch-computed value (`identity`) through a Promise.
     * 状态影响 / State effects: `identity`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `identities.get`, `projectIdentitySchema.parse`, `identityId.replaceAll('-', '').slice`, `identityId.replaceAll`.
     */
    ensure: async (_vm: string, binding: { projectId: string; directory: string; networkIsolation: 'host' | 'private' }) => {
      let identity = identities.get(binding.projectId);
      if (!identity) identity = projectIdentitySchema.parse({ version: 1, phase: 'active', registryId,
        identityId, revision: 1, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
        uid: 20000, gid: 20000, home: '/var/lib/sakura-project-homes/' + identityId,
        homeDevice: '1', homeInode: '2', directoryDevice: '1', directoryInode: '3', ...binding });
      identities.set(binding.projectId, identity); return identity;
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _vm: string; projectId: string。
     * 结果：返回分支计算值（`identities.get(projectId) || null`），以 Promise 交付。
     * Result: Return the branch-computed value (`identities.get(projectId) || null`) through a Promise.
     * 协作入口 / Collaborators: `identities.get`.
     */
    inspect: async (_vm: string, projectId: string) => identities.get(projectId) || null,
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _vm: string; identity: ReturnType<typeof projectIdentitySchema.parse>; binding: { directory: string; networkIsolation: 'host' | 'private' }。
     * 结果：返回分支计算值（`changed`），以 Promise 交付。
     * Result: Return the branch-computed value (`changed`) through a Promise.
     * 协作入口 / Collaborators: `identities.set`.
     */
    rebind: async (_vm: string, identity: ReturnType<typeof projectIdentitySchema.parse>, binding: { directory: string; networkIsolation: 'host' | 'private' }) => {
      const changed = { ...identity, ...binding, revision: identity.revision + 1 };
      identities.set(identity.projectId, changed); return changed;
    },
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('unexpected task payload')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    inheritedInput: async () => { throw new Error('unexpected task payload'); },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _vm: string; identity: ReturnType<typeof projectIdentitySchema.parse>; options: { runId?: string }。
     * 结果：返回分支计算值（`run`），以 Promise 交付。
     * Result: Return the branch-computed value (`run`) through a Promise.
     * 协作入口 / Collaborators: `controlCalls.push`, `projectIdentityRunSchema.parse`, `'a'.repeat`, `runs.set`.
     */
    prepare: async (_vm: string, identity: ReturnType<typeof projectIdentitySchema.parse>, options: { runId?: string }) => {
      controlCalls.push('prepare');
      const runId = options.runId!;
      const run = projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'independent',
        registryId, identityId, projectId: identity.projectId, revision: identity.revision, runId, bootId,
        build: 'a'.repeat(64), networkDevice: '1', networkInode: '4', cgroupDevice: '1', cgroupInode: '5',
        cgroupName: 'sakura-identity-' + runId, namespace: identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : '' });
      runs.set(runId, run); return run;
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _vm: string; _identity: unknown; runId: string。
     * 结果：返回分支计算值（`runs.get(runId)!`），以 Promise 交付。
     * Result: Return the branch-computed value (`runs.get(runId)!`) through a Promise.
     * 协作入口 / Collaborators: `runs.get`.
     */
    run: async (_vm: string, _identity: unknown, runId: string) => runs.get(runId)!,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _vm: string; _identity: unknown; runId: string。
     * 结果：返回分支计算值（`runs.get(runId)!`），以 Promise 交付。
     * Result: Return the branch-computed value (`runs.get(runId)!`) through a Promise.
     * 协作入口 / Collaborators: `runs.get`.
     */
    runReadonly: async (_vm: string, _identity: unknown, runId: string) => runs.get(runId)!,
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _vm: string; _identity: unknown; run: ReturnType<typeof projectIdentityRunSchema.parse>。
     * 结果：返回分支计算值（`closed`），以 Promise 交付。
     * Result: Return the branch-computed value (`closed`) through a Promise.
     * 协作入口 / Collaborators: `controlCalls.push`, `runs.set`.
     */
    stop: async (_vm: string, _identity: unknown, run: ReturnType<typeof projectIdentityRunSchema.parse>) => {
      controlCalls.push('stop'); const closed = { ...run, phase: 'closed' as const }; runs.set(run.runId, closed); return closed;
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `controlCalls.push`.
     */
    retireTerminal: async () => { controlCalls.push('retire'); },
  };
  const options = { scopes: new ProjectRunScopes(machines, { identities: core }), identities: {
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: _vm: string; _identity: unknown; run: ReturnType<typeof projectIdentityRunSchema.parse>; name: string; options: { create?: boolean } = {}。
     * 结果：返回受控对象，公开字段包括 `version, terminalId, run, name, serverPid, serverTicks, sessionId`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `version, terminalId, run, name, serverPid, serverTicks, sessionId`; the actual branch determines its shape.
     * 失败 / Failure: `new AppError('终端窗格未处于项目网络空间', 409)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `controlCalls.push`.
     */
    terminal: async (_vm: string, _identity: unknown, run: ReturnType<typeof projectIdentityRunSchema.parse>, name: string,
      options: { create?: boolean } = {}) => {
      controlCalls.push(options.create ? 'create' : 'probe');
      if (!verified) throw new AppError('终端窗格未处于项目网络空间', 409);
      return { version: 1 as const, terminalId: run.runId, run, name, serverPid: 123, serverTicks: '4', sessionId: '$0' };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _identity: unknown; run: ReturnType<typeof projectIdentityRunSchema.parse>; name: string; readOnly: boolean。
     * 结果：返回分支计算值（``/fixed/project-terminal --run ${run.runId} --name ${name} --readonly ${readOnly…`），以 Promise 交付。
     * Result: Return the branch-computed value (``/fixed/project-terminal --run ${run.runId} --name ${name} --readonly ${readOnly…`) through a Promise.
     */
    terminalCommand: async (_identity: unknown, run: ReturnType<typeof projectIdentityRunSchema.parse>, name: string, readOnly: boolean) =>
      `/fixed/project-terminal --run ${run.runId} --name ${name} --readonly ${readOnly}`,
  } };
  const terminals = new ProjectTerminals(machines, workspaces, undefined, options);
  return { id, bootId, machines, commands, workspaces, terminals, options, identities, runs, controlCalls,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    status: (value: string) => { status = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `persistent`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    persistent: (value: boolean) => { persistent = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `verified`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    verified: (value: boolean) => { verified = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: typeof migration。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `migration`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    migration: (value: typeof migration) => { migration = value; },
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `terminals.close`, `workspaces.close`.
     */
    close: async () => { await terminals.close(); await workspaces.close(); } };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: terminal leases bind to the selected project and block directory or network edits until disconnected
 * 协作入口 / Collaborators: `fixture`, `t.mock.method`, `f.workspaces.save`, `f.terminals.prepare`.
 * 检查边界 / Checked boundaries: `assert.match(privateShell.command, /project-terminal --run/)`; `assert.equal([...f.runs.values()][0].namespace, 'sk-default')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('terminal leases bind to the selected project and block directory or network edits until disconnected', async t => {
  const f = await fixture();
  // Workspaces uses its own scope instance. Stub only the native guest boundary;
  // the scope still persists its release intent and confirms the absent namespace.
  const beginNetworkRelease = t.mock.method(ProjectIdentities.prototype, 'beginNetworkRelease', async (...args:
    Parameters<InstanceType<typeof ProjectIdentities>['beginNetworkRelease']>) => {
    const [vmId, identity, options] = args;
    assert.equal(vmId, f.id);
    assert.deepEqual(identity, f.identities.get('default'));
    assert.equal(identity.networkIsolation, 'private');
    assert.equal(options.bootId, f.bootId);
    assert.match(options.releaseId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    return null;
  });
  try {
    await f.workspaces.save(f.id, { directory: '/workspace/private', networkIsolation: 'private' });
    const privateShell = await f.terminals.prepare(f.id, 'default');
    assert.match(privateShell.command, /project-terminal --run/);
    assert.equal([...f.runs.values()][0].namespace, 'sk-default');
    assert.equal(f.identities.get('default')?.uid, 20000);
    assert.equal(privateShell.projectId, 'default');
    assert.equal(privateShell.networkIsolation, 'private');
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed', networkIsolation: 'private' }), /终端或命令/);
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/private', networkIsolation: 'host' }), /终端或命令/);
    assert.equal(beginNetworkRelease.mock.callCount(), 0);
    await privateShell.release();
    const beforeRelease = f.commands.length;
    await f.workspaces.save(f.id, { directory: '/workspace/private', networkIsolation: 'host' });
    assert.equal(beginNetworkRelease.mock.callCount(), 1);
    assert.equal(f.commands.slice(beforeRelease).filter(command => command.includes('os.path.lexists(path)')).length, 2);
    const shell = await f.terminals.prepare(f.id, null);
    assert.doesNotMatch(shell.command, /netns/);
    assert.match(shell.command, /project-terminal --run/);
    assert.equal([...f.runs.values()].at(-1)?.namespace, '');
    await shell.release();
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: task preparation refuses a missing original directory without creating it or issuing a lease
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.machines.exec.bind`, `assert.rejects`, `f.terminals.prepare`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.terminals.prepare(f.id, 'default', null, false, undefined, undefined, { mode: 'task' }), { code: 'PROJECT_IDENTIT…`; `assert.ok(task.includes("[ ! -d '/workspace' ]") && task.includes("[ -L '/workspace' ]"))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('task preparation refuses a missing original directory without creating it or issuing a lease', async () => {
  const f = await fixture(), execute = f.machines.exec.bind(f.machines);
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`args[1].includes('SAKURA_TASK_DIRECTORY_MISSING:') ? { code: 74, stdout: '', std…`），以 Promise 交付。
   * Result: Return the branch-computed value (`args[1].includes('SAKURA_TASK_DIRECTORY_MISSING:') ? { code: 74, stdout: '', std…`) through a Promise.
   * 验证场景 / Scenario: task preparation refuses a missing original directory without creating it or issuing a lease
   * 协作入口 / Collaborators: `execute`, `args[1].includes`.
   */
  async (...args) => {
    const result = await execute(...args);
    return args[1].includes('SAKURA_TASK_DIRECTORY_MISSING:') ? { code: 74, stdout: '',
      stderr: 'SAKURA_TASK_DIRECTORY_MISSING: 项目目录不存在或是链接，请先显式准备并迁移原目录' } : result;
  };
  try {
    await assert.rejects(f.terminals.prepare(f.id, 'default', null, false, undefined, undefined, { mode: 'task' }),
      { code: 'PROJECT_IDENTITY_DIRECTORY_MISSING' });
    const task = f.commands.at(-1)!;
    assert.ok(task.includes("[ ! -d '/workspace' ]") && task.includes("[ -L '/workspace' ]"));
    assert.doesNotMatch(task, /mkdir -p '\/workspace'/);
    // Execute the exact fixed directory-check fragment against an owned host
    // path. Keep network/package preparation outside this POSIX-shell check.
    const parent = await mkdtemp(join(root, 'directory-check-')), missing = join(parent, 'missing');
    const git = spawnSync('git', ['--exec-path'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(git.status, 0, git.stderr || git.error?.message);
    const shell = process.platform === 'win32' ? resolve(git.stdout.trim(), '../../../usr/bin/sh.exe') : '/bin/sh';
    const unix = process.platform === 'win32' ? missing.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_all, drive) => '/' + drive.toLowerCase()) : missing;
    const check = task.slice(task.lastIndexOf('if [ ! -d ')).replaceAll("'/workspace'", quote(unix));
    const refused = spawnSync(shell, ['-c', check], { encoding: 'utf8', timeout: 5000 });
    assert.equal(refused.status, 74, refused.stderr || refused.error?.message);
    assert.match(refused.stderr, /SAKURA_TASK_DIRECTORY_MISSING:/); await assert.rejects(access(missing), { code: 'ENOENT' });
    await mkdir(missing);
    const existing = spawnSync(shell, ['-c', check], { encoding: 'utf8', timeout: 5000 });
    assert.equal(existing.status, 0, existing.stderr || existing.error?.message); await access(missing);
    const canonical = await realpath(parent);
    assert.equal(dirname(canonical), await realpath(root)); assert.ok(basename(canonical).startsWith('directory-check-'));
    await rm(canonical, { recursive: true, force: true });
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
    const normal = await f.terminals.prepare(f.id, 'default'); await normal.release();
    assert.ok(f.commands.some(command => /mkdir -p '\/workspace'/.test(command)));
    assert.match(normal.command, /project-terminal --run/);
  } finally { await f.close(); }
});

for (const phase of ['applying', 'failed', 'directory-applied', 'invalid'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixture`, `f.migration`, `assert.rejects`, `f.terminals.prepare`.
   * 检查边界 / Checked boundaries: `assert.rejects(f.terminals.prepare(f.id, 'default', 'main', readOnly), { code: phase === 'invalid' ? 'PROJECT_DIRECTORY_LATCH_CHAN…`; `assert.equal(f.commands.length, before + 1, 'Only the read-only admission check may run.')`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test(`${phase} directory migration prevents new terminals and shared reconnects before guest preparation`, async () => {
    const f = await fixture();
    try {
      f.migration(phase);
      for (const readOnly of [false, true]) {
        const before = f.commands.length;
        await assert.rejects(f.terminals.prepare(f.id, 'default', 'main', readOnly),
          { code: phase === 'invalid' ? 'PROJECT_DIRECTORY_LATCH_CHANGED' : 'PROJECT_DIRECTORY_MIGRATION_PENDING' });
        assert.equal(f.commands.length, before + 1, 'Only the read-only admission check may run.');
        assert.doesNotMatch(f.commands.at(-1)!, /apk add|apt-get|mkdir -p|tmux new-session/);
        assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
      }
    } finally { await f.close(); }
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: prepared direct terminal leases block migration across terminal instances until the exact connection releases
 * 协作入口 / Collaborators: `fixture`, `f.terminals.prepare`, `other.prepare`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' })`; `assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, '1111111111111111'))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('prepared direct terminal leases block migration across terminal instances until the exact connection releases', async () => {
  const f = await fixture(), other = new ProjectTerminals(f.machines, f.workspaces, undefined, f.options);
  try {
    const first = await f.terminals.prepare(f.id, 'default');
    const second = await other.prepare(f.id, 'default');
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'),
      { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, '1111111111111111'));
    await other.close();
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'),
      { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    await second.release(); await first.release();
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
  } finally { await other.close(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: disconnected tmux sessions and paused guests still guard project binding changes
 * 协作入口 / Collaborators: `fixture`, `f.persistent`, `assert.rejects`, `f.workspaces.save`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed' }), /所有终端/)`; `assert.equal((await f.workspaces.config(f.id)).directory, '/workspace')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('disconnected tmux sessions and paused guests still guard project binding changes', async () => {
  const f = await fixture();
  try {
    f.persistent(true);
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed' }), /所有终端/);
    assert.equal((await f.workspaces.config(f.id)).directory, '/workspace');
    f.persistent(false);
    f.status('paused');
    await assert.rejects(f.workspaces.save(f.id, { networkIsolation: 'private' }), /恢复实例/);
    f.status('running');
    await f.workspaces.save(f.id, { networkIsolation: 'private' });
    const running = await f.terminals.prepare(f.id, 'default', 'main'); await running.release();
    f.verified(false);
    await assert.rejects(f.terminals.prepare(f.id, 'default', 'main'), /网络空间/);
    await assert.rejects(f.terminals.validate(f.id, 'default', 'main'), /网络空间/);
    await assert.rejects(f.terminals.prepare(f.id, undefined, 'main', true), /重新共享/);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: terminal fallback reads the persisted active project even when the projects plugin is disabled
 * 协作入口 / Collaborators: `fixture`, `f.workspaces.projects.create`, `fallback.prepare`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(shell.projectId, index.active)`; `assert.match(shell.command, /project-terminal --run/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('terminal fallback reads the persisted active project even when the projects plugin is disabled', async () => {
  const f = await fixture();
  try {
    const index = await f.workspaces.projects.create(f.id, 'Private',
      async () => { await f.workspaces.save(f.id, { directory: '/workspace/other', networkIsolation: 'private' }); });
    const fallback = new ProjectTerminals(f.machines, undefined, undefined, f.options);
    try {
      const controller = new AbortController();
      const shell = await fallback.prepare(f.id, null, undefined, false, controller.signal);
      assert.equal(shell.projectId, index.active);
      assert.match(shell.command, /project-terminal --run/);
      assert.equal([...f.runs.values()].at(-1)?.namespace, `sk-${index.active}`);
      controller.abort();
      await shell.release();
      await assert.rejects(fallback.prepare(f.id, null, undefined, false, controller.signal));
      await assert.rejects(fallback.prepare(f.id, '1111111111111111'), /项目不存在/);
    } finally { await fallback.close(); }
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: task preparation captures one configuration and keeps its lease after caller cancellation
 * 状态影响 / State effects: `prepared`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.workspaces.save`, `f.workspaces.config`, `f.terminals.prepare`.
 * 检查边界 / Checked boundaries: `assert.equal(prepared.captured?.configVersion, projectVersion(project))`; `assert.deepEqual(prepared.captured?.project, project)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('task preparation captures one configuration and keeps its lease after caller cancellation', async () => {
  const f = await fixture(), controller = new AbortController();
  let prepared: Awaited<ReturnType<InstanceType<typeof ProjectTerminals>['prepare']>> | undefined;
  try {
    await f.workspaces.save(f.id, { directory: '/workspace/task', environment: { BUILD_VALUE: 'original' } });
    const project = await f.workspaces.config(f.id);
    prepared = await f.terminals.prepare(f.id, 'default', null, false, controller.signal, undefined, { mode: 'task' });
    assert.equal(prepared.captured?.configVersion, projectVersion(project));
    assert.deepEqual(prepared.captured?.project, project);
    assert.equal(prepared.captured?.live, f.machines.live.get(f.id));
    await f.workspaces.save(f.id, { ...project, environment: { BUILD_VALUE: 'next' } });
    assert.equal(prepared.captured?.project.environment?.BUILD_VALUE, 'original');
    controller.abort();
    assert.equal(prepared.signal?.aborted, true);
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'),
      { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed' }), /终端或命令/);
    prepared.release(); prepared.release();
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
    await f.workspaces.save(f.id, { directory: '/workspace/changed' });
  } finally { prepared?.release(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: closing waits for explicit task cleanup and keeps configuration guards until that release
 * 状态影响 / State effects: `prepared`, `closing`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.terminals.prepare`, `assert.equal`, `f.terminals.close().then`.
 * 检查边界 / Checked boundaries: `assert.equal(connection.captured, undefined)`; `assert.equal(prepared.signal?.aborted, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('closing waits for explicit task cleanup and keeps configuration guards until that release', async () => {
  const f = await fixture();
  let prepared: Awaited<ReturnType<InstanceType<typeof ProjectTerminals>['prepare']>> | undefined;
  let closing: Promise<void> | undefined;
  try {
    const connection = await f.terminals.prepare(f.id, 'default');
    assert.equal(connection.captured, undefined);
    prepared = await f.terminals.prepare(f.id, 'default', null, false, undefined, undefined, { mode: 'task' });
    let closed = false;
    closing = f.terminals.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(prepared.signal?.aborted, true);
    assert.equal(closed, false);
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed' }), /终端或命令/);
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'),
      { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    prepared.release();
    await closing;
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
    await f.workspaces.save(f.id, { directory: '/workspace/changed' });
    connection.release();
  } finally { prepared?.release(); await closing; await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: verification-only task binding holds a lease without network repair, packages or native issuance
 * 状态影响 / State effects: `f.commands.length`, `f.controlCalls.length`, `prepared`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.workspaces.save`, `f.terminals.prepare`, `f.commands.find`.
 * 检查边界 / Checked boundaries: `assert.ok(check.includes('SAKURA_TASK_NETWORK_MISSING:'))`; `assert.doesNotMatch(check, /apk add|apt-get|mkdir|netns add|useradd|adduser|tmux/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('verification-only task binding holds a lease without network repair, packages or native issuance', async () => {
  const f = await fixture();
  let prepared: Awaited<ReturnType<InstanceType<typeof ProjectTerminals>['prepare']>> | undefined;
  try {
    await f.workspaces.save(f.id, { directory: '/workspace/readonly', networkIsolation: 'private' });
    f.commands.length = 0; f.controlCalls.length = 0;
    prepared = await f.terminals.prepare(f.id, 'default', null, false, undefined, undefined,
      { mode: 'task', verifyOnly: true });
    const check = f.commands.find(command => command.includes('SAKURA_TASK_DIRECTORY_MISSING:'))!;
    assert.ok(check.includes('SAKURA_TASK_NETWORK_MISSING:'));
    assert.doesNotMatch(check, /apk add|apt-get|mkdir|netns add|useradd|adduser|tmux/);
    assert.deepEqual(f.controlCalls, []);
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'),
      { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed', networkIsolation: 'private' }), /终端或命令/);
    await prepared.release();
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
  } finally { await prepared?.release(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: verification-only task binding refuses a missing namespace without issuing a lease
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.workspaces.save`, `assert.rejects`, `f.terminals.prepare`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.terminals.prepare(f.id, 'default', null, false, undefined, undefined, { mode: 'task', verifyOnly: true }), { stat…`; `assert.deepEqual(f.controlCalls, [])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('verification-only task binding refuses a missing namespace without issuing a lease', async () => {
  const f = await fixture(), execute = f.machines.exec;
  try {
    await f.workspaces.save(f.id, { directory: '/workspace/readonly', networkIsolation: 'private' });
    f.machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`args[1].includes('SAKURA_TASK_NETWORK_MISSING:') ? { code: 74, stdout: '', stder…`），以 Promise 交付。
     * Result: Return the branch-computed value (`args[1].includes('SAKURA_TASK_NETWORK_MISSING:') ? { code: 74, stdout: '', stder…`) through a Promise.
     * 验证场景 / Scenario: verification-only task binding refuses a missing namespace without issuing a lease
     * 协作入口 / Collaborators: `args[1].includes`, `execute`.
     */
    async (...args) => args[1].includes('SAKURA_TASK_NETWORK_MISSING:') ?
      { code: 74, stdout: '', stderr: 'SAKURA_TASK_NETWORK_MISSING: missing original namespace' } : execute(...args);
    await assert.rejects(f.terminals.prepare(f.id, 'default', null, false, undefined, undefined,
      { mode: 'task', verifyOnly: true }), { status: 409 });
    assert.deepEqual(f.controlCalls, []);
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: task preparation rejects attaching a tmux or read-only connection before guest actions
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.terminals.prepare`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.terminals.prepare(f.id, 'default', 'main', false, undefined, undefined, { mode: 'task' }), { status: 400 })`; `assert.rejects(f.terminals.prepare(f.id, 'default', null, true, undefined, undefined, { mode: 'task' }), { status: 400 })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('task preparation rejects attaching a tmux or read-only connection before guest actions', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.terminals.prepare(f.id, 'default', 'main', false, undefined, undefined, { mode: 'task' }),
      { status: 400 });
    await assert.rejects(f.terminals.prepare(f.id, 'default', null, true, undefined, undefined, { mode: 'task' }),
      { status: 400 });
    await assert.rejects(f.terminals.prepare(f.id, 'default', null, false, undefined, undefined, { verifyOnly: true }),
      { status: 400 });
    assert.deepEqual(f.commands, []);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a replaced live instance cannot inherit a preparation lease or its captured configuration
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.terminals.prepare`, `assert.doesNotThrow`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.terminals.prepare(f.id, 'default', null, false, undefined, undefined, { mode: 'task' }), /客户机运行身份在准备期间改变/)`; `assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a replaced live instance cannot inherit a preparation lease or its captured configuration', async () => {
  const f = await fixture(), execute = f.machines.exec;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: a replaced live instance cannot inherit a preparation lease or its captured configuration
   * 协作入口 / Collaborators: `execute`, `args[1].includes`, `f.machines.live.set`.
   */
  async (...args) => {
    const result = await execute(...args);
    if (args[1].includes('SAKURA_TASK_DIRECTORY_MISSING:')) f.machines.live.set(f.id, {} as never);
    return result;
  };
  try {
    await assert.rejects(f.terminals.prepare(f.id, 'default', null, false, undefined, undefined, { mode: 'task' }),
      /客户机运行身份在准备期间改变/);
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: named terminals survive disconnect and reload while readonly reconnection does not prepare guest tools
 * 协作入口 / Collaborators: `fixture`, `f.terminals.prepare`, `first.release`, `f.controlCalls.filter`.
 * 检查边界 / Checked boundaries: `assert.equal(view.terminalId, first.terminalId)`; `assert.match(view.command, /--readonly true/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('named terminals survive disconnect and reload while readonly reconnection does not prepare guest tools', async () => {
  const f = await fixture(), reopened = new ProjectTerminals(f.machines, f.workspaces, undefined, f.options);
  try {
    const first = await f.terminals.prepare(f.id, 'default', 'main'); await first.release();
    const before = f.commands.length, creates = f.controlCalls.filter(call => call === 'create').length;
    const view = await reopened.prepare(f.id, 'default', 'main', true, undefined, first.terminalId);
    assert.equal(view.terminalId, first.terminalId);
    assert.match(view.command, /--readonly true/);
    assert.equal(f.commands.length, before + 1, 'Only the migration admission read runs outside the readonly controller.');
    assert.equal(f.controlCalls.filter(call => call === 'create').length, creates);
    await view.release();
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/replaced' }),
      { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
    await reopened.stop(f.id, 'default', 'main');
    assert.deepEqual(f.controlCalls.slice(-2), ['stop', 'retire']);
    await f.workspaces.save(f.id, { directory: '/workspace/replaced' });
  } finally { await reopened.close(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: recreating the same terminal label cannot revive an old shared terminal ID
 * 协作入口 / Collaborators: `fixture`, `f.terminals.prepare`, `first.release`, `f.terminals.stop`.
 * 检查边界 / Checked boundaries: `assert.notEqual(first.terminalId, next.terminalId)`; `assert.rejects(f.terminals.prepare(f.id, 'default', 'main', true, undefined, first.terminalId), { code: 'PROJECT_TERMINAL_SHARE_ST…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('recreating the same terminal label cannot revive an old shared terminal ID', async () => {
  const f = await fixture();
  try {
    const first = await f.terminals.prepare(f.id, 'default', 'main'); await first.release();
    await f.terminals.stop(f.id, 'default', 'main');
    const next = await f.terminals.prepare(f.id, 'default', 'main'); await next.release();
    assert.notEqual(first.terminalId, next.terminalId);
    const calls = f.controlCalls.length;
    await assert.rejects(f.terminals.prepare(f.id, 'default', 'main', true, undefined, first.terminalId),
      { code: 'PROJECT_TERMINAL_SHARE_STALE' });
    assert.equal(f.controlCalls.length, calls, 'A stale viewer never probes, recreates or attaches another terminal.');
    const grant = await f.terminals.validate(f.id, 'default', 'main'); assert.equal(grant.terminalId, next.terminalId);
    await f.terminals.stop(f.id, 'default');
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a failed anonymous terminal cleanup retains the lease and retries its original run
 * 状态影响 / State effects: `f.options.scopes.stopTerminal`, `failing`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.options.scopes.stopTerminal.bind`, `f.terminals.prepare`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(Promise.resolve(connection.release()), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a failed anonymous terminal cleanup retains the lease and retries its original run', async () => {
  const f = await fixture(), stop = f.options.scopes.stopTerminal.bind(f.options.scopes);
  let failing = true;
  f.options.scopes.stopTerminal = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`stop(...args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`stop(...args)`) through a Promise.
   * 验证场景 / Scenario: a failed anonymous terminal cleanup retains the lease and retries its original run
   * 失败 / Failure: `new AppError('owned cleanup lost', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `stop`.
   */
  async (...args) => {
    if (failing) throw new AppError('owned cleanup lost', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    return stop(...args);
  };
  try {
    const connection = await f.terminals.prepare(f.id, 'default');
    await assert.rejects(Promise.resolve(connection.release()), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    assert.equal((await f.options.scopes.terminalRuns(f.id, 'default'))[0].runId, connection.terminalId);
    await assert.rejects(f.terminals.close(), /清理未确认/);
    failing = false; await connection.release();
    assert.equal((await f.options.scopes.terminalRuns(f.id, 'default')).length, 0);
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
  } finally { failing = false; await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: recovery stops only unconnected anonymous runs and preserves a live connection and named server
 * 协作入口 / Collaborators: `fixture`, `f.terminals.prepare`, `named.release`, `f.workspaces.config`.
 * 检查边界 / Checked boundaries: `assert.ok(!active.some(entry => entry.runId === orphanId))`; `assert.ok(active.some(entry => entry.runId === first.terminalId))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('recovery stops only unconnected anonymous runs and preserves a live connection and named server', async () => {
  const f = await fixture();
  try {
    const first = await f.terminals.prepare(f.id, 'default');
    const named = await f.terminals.prepare(f.id, 'default', 'main'); await named.release();
    const project = await f.workspaces.config(f.id), orphanId = randomUUID();
    await f.options.scopes.prepareTerminal(f.id, project, orphanId,
      { name: 'sakura-terminal-default-orphan', persistent: false });
    const next = await f.terminals.prepare(f.id, 'default');
    const active = await f.options.scopes.terminalRuns(f.id, 'default');
    assert.ok(!active.some(entry => entry.runId === orphanId));
    assert.ok(active.some(entry => entry.runId === first.terminalId));
    assert.ok(active.some(entry => entry.runId === named.terminalId));
    await first.release(); await next.release(); await f.terminals.stop(f.id, 'default');
  } finally { await f.close(); }
});
