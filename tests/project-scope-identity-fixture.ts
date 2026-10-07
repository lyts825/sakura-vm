/**
 * 模块职责：共享测试夹具模块，围绕 `project-scope-identity-fixture` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Shared test fixture for `project-scope-identity-fixture`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock } from 'node:test';
import type { Machines } from '../server/machines.ts';
import { AppError } from '../server/model.ts';
import { ProjectIdentities, projectIdentityPayload, type ProjectIdentity, type ProjectIdentityRun,
  type ProjectIdentityExecution, type ProjectIdentityNetwork, type ProjectIdentityNetworkLease,
  type ProjectIdentityNetworkRelease } from '../server/project-identity.ts';
import { ProjectRunScopes } from '../server/project-run-scope.ts';
import type { Project } from '../server/workspaces.ts';
import type { ProjectMainRecord, ProjectServiceRecord } from '../server/project-service-scope.ts';

type Record = ProjectMainRecord | ProjectServiceRecord;
type Context = ReturnType<typeof scopeIdentityFixture>;
const contexts = new WeakMap<object, Context>();
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: core: object。
 * 结果：返回分支计算值（`value`）。
 * Result: Return the branch-computed value (`value`).
 * 协作入口 / Collaborators: `contexts.get`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(value, 'identity test core must be registered for this transport')`.
 */
const context = (core: object) => {
  const value = contexts.get((core as { machines: object }).machines);
  assert.ok(value, 'identity test core must be registered for this transport');
  return value;
};
for (const method of ['ensure', 'inspect', 'rebind', 'inheritedInput', 'run', 'runReadonly', 'stop', 'network', 'beginNetworkRelease', 'releaseNetwork'] as const)
  mock.method(ProjectIdentities.prototype, method, function(this: ProjectIdentities, ...args: any[]) {
    return (context(this)[method] as /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: values: any[]。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (...values: any[]) => unknown)(...args);
  });

/** Only the guest core is simulated. Host journals and binary payload encoding stay real. */
/**
 * 中文功能：为受控机器传输接入项目身份控制器，记录身份、运行、网络租约和受保护启动输入，供多种项目作用域共用。
 * English: Attach a controlled project-identity controller to machine transport and record identities, runs, network leases and protected launch inputs for shared scope tests.
 * 输入 / Inputs: machines: Machines; project: Project; boot: () => string; record: (runId: string) => Record | null; probe: (execution: ProjectIdentityExecution) => number。
 * 结果：返回分支计算值（`fixture`）。
 * Result: Return the branch-computed value (`fixture`).
 * 状态影响 / State effects: `machines.exec`, `machines.execInput`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `machines.exec.bind`, `contexts.set`.
 * 设计思路：按传输实例保存上下文，身份、运行票据和网络释放分别维护；断言检查正文与完整票据的对应关系，使陈旧运行、撤销和恢复用例复用相同权威模型。
 * Design: Bind context to each transport instance while keeping identity, run tickets and network releases separate. Assertions tie protected input to the complete ticket, letting stale-run, revocation and recovery tests reuse one authority model.
 */
export function scopeIdentityFixture(machines: Machines, project: Project, boot: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => string,
  record: /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: runId: string。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (runId: string) => Record | null, probe?: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: execution: ProjectIdentityExecution。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (execution: ProjectIdentityExecution) => number) {
  const identities = new Map<string, ProjectIdentity>(), tickets = new Map<string, ProjectIdentityRun>();
  const networks = new Map<string, ProjectIdentityNetwork>(), networkLeases = new Map<string, ProjectIdentityNetworkLease>(),
    releasedNetworks = new Map<string, ProjectIdentityNetworkRelease>();
  const taskScopes = new Set<string>(), payloads = new Map<string, Buffer>(), inputs: Buffer[] = [];
  const state = { stopFailures: 0, readonlyCalls: 0, ensureCalls: 0, stopCalls: 0,
    networkBeginCalls: 0, networkReleaseCalls: 0, networkReleaseFailures: 0 };
  const existingExec = machines.exec.bind(machines);
  /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: runId: string; kind: 'main' | 'service' | 'task'; inode: string。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `tickets.has`, `identities.get`, `assert.ok`, `networks.has`.
   * 检查边界 / Checked boundaries: `assert.ok(identity)`.
   */
  const activate = (runId: string, kind: 'main' | 'service' | 'task', inode: string) => {
    if (tickets.has(runId)) return;
    const identity = identities.get(project._workspace || 'default')!;
    assert.ok(identity);
    if (identity.networkIsolation === 'private' && (!networks.has(identity.projectId) || networks.get(identity.projectId)!.bootId !== boot()))
      networks.set(identity.projectId, { version: 1, registryId: identity.registryId, identityId: identity.identityId,
        projectId: identity.projectId, revision: identity.revision, bootId: boot(), namespace: 'sk-' + identity.projectId,
        networkDevice: '4', networkInode: '5', generation: randomUUID() });
    tickets.set(runId, { version: 1, phase: 'active', mode: 'inherit-current', registryId: identity.registryId,
      identityId: identity.identityId, projectId: identity.projectId, runId, revision: identity.revision,
      bootId: boot(), build: 'a'.repeat(64), networkDevice: '4', networkInode: '5', cgroupDevice: '6',
      cgroupInode: inode, cgroupName: `sakura-${kind}-${runId}`,
      namespace: identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : '' });
  };
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: id; command; rest。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `command.split('\n').find`, `command.split`, `JSON.parse`, `Buffer.from(scopeLine.split('=')[1], 'base64').toString`.
   * 检查边界 / Checked boundaries: `assert.ok(found)`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  async (id, command, ...rest) => {
    const scopeLine = command.split('\n').find(line => /^# SAKURA_PROJECT_(MAIN|SERVICE)_REQUEST=/.test(line));
    const request = scopeLine ? JSON.parse(Buffer.from(scopeLine.split('=')[1], 'base64').toString()) : null;
    if (request) {
      try { return await existingExec(id, command, ...rest); }
      finally {
        const value = request.record && record(request.record.runId);
        if (request.op === 'commit' && value?.phase === 'running')
          activate(value.runId, value.version === 2 ? 'main' : 'service', value.inode!);
      }
    }
    if (command.includes('assert not os.path.lexists') && command.includes('absent') && /sakura-(main|service|task)-[a-f0-9-]{36}/.test(command)) {
      const found = command.match(/sakura-(main|service|task)-([a-f0-9-]{36})/);
      assert.ok(found);
      const value = record(found[2]);
      const absent = !taskScopes.has(found[2]) && (!value || value.phase === 'stopped' || value.bootId !== boot());
      return absent ? { code: 0, stdout: JSON.stringify({ bootId: boot(), absent: true }), stderr: '' }
        : { code: 73, stdout: '', stderr: 'owned scope remains present' };
    }
    if (command.trim().endsWith('/proc/sys/kernel/random/boot_id'))
      return { code: 0, stdout: boot(), stderr: '' };
    if (command.includes('/var/lib/sakura/project-directory-migrations/') && command.includes('latch.json'))
      return { code: 0, stdout: 'null', stderr: '' };
    if (command.includes('/run/netns/sk-') && command.includes('assert not os.path.lexists'))
      return { code: 0, stdout: JSON.stringify({ bootId: boot(), absent: true }), stderr: '' };
    const task = command.match(/sakura-task-([a-f0-9-]{36})/);
    if (task && command.includes('cgroup.kill')) taskScopes.delete(task[1]);
    return existingExec(id, command, ...rest);
  };
  machines.execInput = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: id; command; input; rest。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `inputs.push`, `Buffer.from`, `assert.ok`, `command.includes`.
   * 检查边界 / Checked boundaries: `assert.ok(!command.includes('owned-main-private-token'))`; `assert.equal(request.op, 'start')`.
   */
  async (id, command, input, ...rest) => {
    inputs.push(Buffer.from(input));
    assert.ok(!command.includes('owned-main-private-token'));
    const requestLine = command.split('\n').find(line => /^# SAKURA_PROJECT_(MAIN|SERVICE)_REQUEST=/.test(line));
    if (requestLine) {
      const request = JSON.parse(Buffer.from(requestLine.split('=')[1], 'base64').toString());
      assert.equal(request.op, 'start');
      assert.deepEqual(input, payloads.get(request.record.runId));
      return machines.exec(id, command, ...rest);
    }
    const task = command.match(/\.sakura-job-([a-f0-9-]{36})\.pid/);
    assert.ok(task, 'protected task must retain the exact outer scope run ID');
    assert.deepEqual(input, payloads.get(task[1]));
    taskScopes.add(task[1]); activate(task[1], 'task', '23456');
    const length = input.readUInt32LE(24), script = input.subarray(32, 32 + length).toString();
    return { code: probe?.({ command: script }) || 0, stdout: '', stderr: '' };
  };
  const fixture = {
    state, tickets, payloads, inputs, activate, networks, networkLeases, releasedNetworks,
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: _id: string; binding: { projectId: string; directory: string; networkIsolation: 'host' …。
     * 结果：返回分支计算值（`identity`），以 Promise 交付。
     * Result: Return the branch-computed value (`identity`) through a Promise.
     * 状态影响 / State effects: `identity`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `identities.get`, `randomUUID`, `identityId.replaceAll('-', '').slice`, `identityId.replaceAll`.
     */
    ensure: async (_id: string, binding: { projectId: string; directory: string; networkIsolation: 'host' | 'private' }) => {
      ++state.ensureCalls;
      let identity = identities.get(binding.projectId);
      if (!identity) {
        const identityId = randomUUID();
        identity = { version: 1, phase: 'active', registryId: randomUUID(), projectId: binding.projectId,
          identityId, revision: 1, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 20001, gid: 20001,
          home: '/var/lib/sakura-project-homes/' + identityId, directory: binding.directory,
          directoryDevice: '1', directoryInode: '2', homeDevice: '1', homeInode: '3', networkIsolation: binding.networkIsolation };
        identities.set(binding.projectId, identity);
      }
      return identity;
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; projectId: string。
     * 结果：返回分支计算值（`identities.get(projectId) || null`），以 Promise 交付。
     * Result: Return the branch-computed value (`identities.get(projectId) || null`) through a Promise.
     * 协作入口 / Collaborators: `identities.get`.
     */
    inspect: async (_id: string, projectId: string) => identities.get(projectId) || null,
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id: string; identity: ProjectIdentity; binding: object。
     * 结果：返回分支计算值（`updated`），以 Promise 交付。
     * Result: Return the branch-computed value (`updated`) through a Promise.
     * 协作入口 / Collaborators: `identities.set`, `networks.delete`.
     */
    rebind: async (_id: string, identity: ProjectIdentity, binding: object) => {
      const updated = { ...identity, ...binding, revision: identity.revision + 1 };
      identities.set(identity.projectId, updated); networks.delete(identity.projectId); return updated;
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _identity: ProjectIdentity; execution: ProjectIdentityExecution; options: { runId: string }。
     * 结果：返回受控对象，公开字段包括 `runId, command`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `runId, command`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `projectIdentityPayload`, `payloads.set`.
     */
    inheritedInput: async (_identity: ProjectIdentity, execution: ProjectIdentityExecution, options: { runId: string }) => {
      const payload = projectIdentityPayload(execution); payloads.set(options.runId, payload.input);
      return { ...payload, runId: options.runId,
        command: `/usr/bin/env -i /owned-identity-controller ${options.runId} ${payload.sha256}` };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; _identity: ProjectIdentity; runId: string。
     * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
     * 失败 / Failure: `new AppError('owned ticket absent', 409, 'PROJECT_IDENTITY_RECORD_ABSENT')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `tickets.get`.
     */
    run: async (_id: string, _identity: ProjectIdentity, runId: string) => {
      const ticket = tickets.get(runId);
      if (!ticket) throw new AppError('owned ticket absent', 409, 'PROJECT_IDENTITY_RECORD_ABSENT');
      return { ...ticket };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; identity: ProjectIdentity; runId: string。
     * 结果：返回分支计算值（`fixture.run(_id, identity, runId)`），以 Promise 交付。
     * Result: Return the branch-computed value (`fixture.run(_id, identity, runId)`) through a Promise.
     * 协作入口 / Collaborators: `fixture.run`.
     */
    runReadonly: async (_id: string, identity: ProjectIdentity, runId: string) => {
      ++state.readonlyCalls; return fixture.run(_id, identity, runId);
    },
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: _id: string; _identity: ProjectIdentity; ticket: ProjectIdentityRun。
     * 结果：返回分支计算值（`closed`），以 Promise 交付。
     * Result: Return the branch-computed value (`closed`) through a Promise.
     * 失败 / Failure: `new AppError('owned ticket cleanup connection failed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `assert.ok`, `taskScopes.has`, `record`, `boot`.
     * 检查边界 / Checked boundaries: `assert.ok(!taskScopes.has(ticket.runId))`; `assert.ok(!value || value.phase === 'stopped' || value.bootId !== boot())`.
     */
    stop: async (_id: string, _identity: ProjectIdentity, ticket: ProjectIdentityRun) => {
      ++state.stopCalls;
      if (state.stopFailures-- > 0) throw new AppError('owned ticket cleanup connection failed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      assert.ok(!taskScopes.has(ticket.runId));
      const value = record(ticket.runId);
      assert.ok(!value || value.phase === 'stopped' || value.bootId !== boot());
      const closed = { ...ticket, phase: 'closed' as const }; tickets.set(ticket.runId, closed); return closed;
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; identity: ProjectIdentity。
     * 结果：返回分支计算值（`networks.get(identity.projectId) || null`），以 Promise 交付。
     * Result: Return the branch-computed value (`networks.get(identity.projectId) || null`) through a Promise.
     * 协作入口 / Collaborators: `networks.get`.
     */
    network: async (_id: string, identity: ProjectIdentity) => networks.get(identity.projectId) || null,
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: _id: string; identity: ProjectIdentity; options: { releaseId: string; bootId: string }。
     * 结果：返回分支计算值（`prior / null`），以 Promise 交付。
     * Result: Return the branch-computed value (`prior / null`) through a Promise.
     * 协作入口 / Collaborators: `assert.equal`, `boot`, `networkLeases.get`, `networks.get`.
     * 检查边界 / Checked boundaries: `assert.equal(options.bootId, boot())`; `assert.equal(network.identityId, identity.identityId)`.
     */
    beginNetworkRelease: async (_id: string, identity: ProjectIdentity, options: { releaseId: string; bootId: string }) => {
      ++state.networkBeginCalls; assert.equal(options.bootId, boot());
      const prior = networkLeases.get(options.releaseId);
      if (prior) return prior;
      const network = networks.get(identity.projectId);
      if (!network || network.bootId !== boot()) return null;
      assert.equal(network.identityId, identity.identityId); assert.equal(network.revision, identity.revision);
      const lease: ProjectIdentityNetworkLease = { version: 1, phase: 'pending', releaseId: options.releaseId, network };
      networkLeases.set(options.releaseId, lease); return lease;
    },
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: _id: string; identity: ProjectIdentity; lease: ProjectIdentityNetworkLease。
     * 结果：返回分支计算值（`prior / released`），以 Promise 交付。
     * Result: Return the branch-computed value (`prior / released`) through a Promise.
     * 失败 / Failure: `new AppError('owned-main-private-token network reply lost', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_F…`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `releasedNetworks.get`, `assert.deepEqual`, `networkLeases.get`, `networks.get`.
     * 检查边界 / Checked boundaries: `assert.deepEqual(prior.network, lease.network)`; `assert.deepEqual(networkLeases.get(lease.releaseId), lease)`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    releaseNetwork: async (_id: string, identity: ProjectIdentity, lease: ProjectIdentityNetworkLease) => {
      ++state.networkReleaseCalls;
      if (state.networkReleaseFailures-- > 0) throw new AppError('owned-main-private-token network reply lost', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      const prior = releasedNetworks.get(lease.releaseId);
      if (prior) { assert.deepEqual(prior.network, lease.network); return prior; }
      assert.deepEqual(networkLeases.get(lease.releaseId), lease);
      assert.deepEqual(networks.get(identity.projectId), lease.network);
      for (const ticket of tickets.values()) if (ticket.projectId === identity.projectId && ticket.bootId === boot()) assert.equal(ticket.phase, 'closed');
      const released: ProjectIdentityNetworkRelease = { version: 1, phase: 'released', releaseId: lease.releaseId, network: lease.network };
      releasedNetworks.set(lease.releaseId, released); networks.delete(identity.projectId); return released;
    },
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: id: string; intent: Record; execution: ProjectIdentityExecution = { command: project.command, environment: proj…。
     * 结果：返回分支计算值（`new ProjectRunScopes(machines).inherited(id, project, execution, { kind: intent.…`）。
     * Result: Return the branch-computed value (`new ProjectRunScopes(machines).inherited(id, project, execution, { kind: intent.…`).
     * 协作入口 / Collaborators: `new ProjectRunScopes(machines).inherited`.
     */
    payload: (id: string, intent: Record, execution: ProjectIdentityExecution = { command: project.command, environment: project.environment }) =>
      new ProjectRunScopes(machines).inherited(id, project, execution,
        { kind: intent.version === 2 ? 'main' : 'service', runId: intent.runId, bootId: intent.bootId }),
  };
  contexts.set(machines, fixture); return fixture;
}
