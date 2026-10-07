/**
 * 模块职责：共享测试夹具模块，围绕 `desktop-identity-fixture` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Shared test fixture for `desktop-identity-fixture`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 */
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { Machines as MachinesType } from '../server/machines.ts';
import type { Project, Workspaces as WorkspacesType } from '../server/workspaces.ts';
import type { ProjectDesktopRecord } from '../server/project-service-scope.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-desktop-uid-model-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Workspaces, projectVersion } = await import('../server/workspaces.ts');
const { ProjectDesktops } = await import('../server/desktop-project.ts');
const { ProjectDesktopScope } = await import('../server/project-service-scope.ts');
const { DesktopBindings, projectDesktopBindingSchema } = await import('../server/desktop-binding.ts');
const { desktopProjectCommand, desktopAdapterSource } = await import('../server/desktop-project-control.ts');
const { desktopUidCommand, desktopProjectPrepare, desktopProjectEnvironment, desktopProjectImePrepare, desktopProjectImeCommand } = await import('../server/desktop-guest.ts');
const { projectIdentityPayload } = await import('../server/project-identity.ts');
const { assertProjectTerminalsStopped } = await import('../server/project-terminals.ts');
const { vmDir, AppError } = await import('../server/model.ts');
const { defaultDesktopPreferences } = await import('../server/desktop-preferences.ts');
const { scopeIdentityFixture } = await import('./project-scope-identity-fixture.ts');
after(() => rm(root, { recursive: true, force: true }));
/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: command: string。
 * 结果：返回分支计算值（`line ? JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString()) : null`）。
 * Result: Return the branch-computed value (`line ? JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString()) : null`).
 * 协作入口 / Collaborators: `command.split('\n').find`, `command.split`, `JSON.parse`, `Buffer.from(line.split('=')[1], 'base64').toString`.
 */
const extractRequest = (command: string) => {
  const line = command.split('\n').find(line => line.startsWith('# SAKURA_PROJECT_SERVICE_REQUEST='));
  return line ? JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString()) : null;
};

/**
 * 中文功能：组合两个项目、桌面运行记录、入口绑定与身份夹具，为桌面归属和邻居保护用例提供可变证据。
 * English: Compose two projects, desktop run records, endpoint bindings and identity fixtures to expose mutable evidence for desktop ownership and neighbor protection.
 * 输入 / Inputs: t: TestContext; mode = ''。
 * 结果：返回受控对象，公开字段包括 `id, boot, live, alpha, beta, owner, state, records, machines`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, boot, live, alpha, beta, owner, state, records, machines`; the actual branch determines its shape.
 * 状态影响 / State effects: `identity.ensure`, `workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `Object.assign`, `machineLocks.locked.bind`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.equal(Object.getOwnPropertyDescriptor(config, '_workspace')!.enumerable, false)`.
 * 设计思路：将入口漂移、证明失败、关闭失败和项目切换分别注入，同时保留原运行记录；用例依据完整记录确认授权及清理，不能仅凭端口可达认定桌面归属。
 * Design: Inject endpoint drift, proof/close failures and project switches independently while retaining the original run record. Tests establish authority and cleanup from the complete record rather than endpoint reachability alone.
 */
export async function fixture(t: TestContext, mode = '') {
  const id = randomUUID(), boot = randomUUID(), live = { status: 'running', startedAt: 'desktop-model-live' };
  const machineLocks = new Machines({} as any), owner = { record: null as ProjectDesktopRecord | null, inode: null as string | null };
  const state = { boot, stopFailures: 0, guardFailure: false, cleanupFailure: false, probeFailure: false,
    endpointDrift: false, stopCalls: 0, killed: 0, neighbor: true, detached: false, installed: true,
    preparations: 0, beforePrepare: undefined as (/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: signal: AbortSignal。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (signal?: AbortSignal) => Promise<void>) | undefined, entered: [] as string[], commands: [] as string[], probes: 0, onProbe: undefined as (/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<void>) | undefined,
    onCommit: undefined as (/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void) | undefined, beforeResolve: undefined as (/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<void>) | undefined };
  const records = new Map<string, ProjectDesktopRecord>();
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { id, distro: 'alpine', memoryMiB: 2048, snapshots: [] }]]),
    live: new Map([[id, live]]), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id, distro: 'alpine', memoryMiB: 2048, snapshots: [] })`）。
     * Result: Return the branch-computed value (`({ id, distro: 'alpine', memoryMiB: 2048, snapshots: [] })`).
     */
    get: () => ({ id, distro: 'alpine', memoryMiB: 2048, snapshots: [] }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`machines.live.get(id)?.status || 'stopped'`）。
     * Result: Return the branch-computed value (`machines.live.get(id)?.status || 'stopped'`).
     * 协作入口 / Collaborators: `machines.live.get`.
     */
    state: () => machines.live.get(id)?.status || 'stopped', closing: false, /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    requireUnlocked() {},
    locked: machineLocks.locked.bind(machineLocks),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string; _timeout: number; signal: AbortSignal。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 状态影响 / State effects: `state.installed`, `owner.record`, `owner.inode`, `fixtureProject._workspace`, `state.detached`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('native-independent prepare ACK lost')`; `new Error('pane ACK lost')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `signal?.throwIfAborted`, `state.commands.push`, `extractRequest`, `command.startsWith`.
     * 检查边界 / Checked boundaries: `assert.equal(request.namespace, 'desktop')`; `assert.match(request.guest, /^\/run\/sakura-project-desktop\/(default|[a-f0-9]{16})$/)`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    exec: async (_id: string, command: string, _timeout?: number, signal?: AbortSignal) => {
      signal?.throwIfAborted(); state.commands.push(command);
      const request = extractRequest(command);
      if (!request) {
        if (command.startsWith('# SAKURA_GUEST_TASK_RUN') && command.includes('apk add')) {
          ++state.preparations; await state.beforePrepare?.(signal); state.installed = true;
          return { code: 0, stdout: '', stderr: '' };
        }
        if (command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS')) return { code: 0, stdout: 'absent', stderr: '' };
        if (command.startsWith('if [ ! -f /etc/sakura/desktop-version ]')) return { code: 0, stdout: 'stopped', stderr: '' };
        if (command.includes('sakura-desktop-project-version')) return { code: state.installed ? 0 : 1, stdout: '', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      }
      assert.equal(request.namespace, 'desktop');
      assert.match(request.guest, /^\/run\/sakura-project-desktop\/(default|[a-f0-9]{16})$/);
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: status: string; record: ProjectDesktopRecord | null。
       * 结果：返回分支计算值（`({ code: 0, stdout: JSON.stringify({ status, bootId: state.boot, record }), stde…`）。
       * Result: Return the branch-computed value (`({ code: 0, stdout: JSON.stringify({ status, bootId: state.boot, record }), stde…`).
       * 协作入口 / Collaborators: `JSON.stringify`.
       */
      const reply = (status: string, record: ProjectDesktopRecord | null) => ({ code: 0,
        stdout: JSON.stringify({ status, bootId: state.boot, record }), stderr: '' });
      if (request.op === 'probe-reboot') return { code: owner.record && owner.record.bootId !== state.boot ? 73 : 0,
        stdout: JSON.stringify({ bootId: state.boot, retired: state.boot !== request.record.bootId }), stderr: '' };
      if (request.op === 'status') {
        if (owner.record && owner.inode !== owner.record.inode) return { code: 73, stdout: '', stderr: 'exact cgroup inode replaced' };
        return reply(owner.record?.phase || 'absent', owner.record);
      }
      const intent = request.record as ProjectDesktopRecord;
      const process = new ProjectDesktopScope(machines as unknown as MachinesType, id,
        { template: 'none', directory: '/workspace/alpha', repository: '', setup: '', command: '', _workspace: intent.projectId });
      if (request.op === 'prepare') {
        const saved = JSON.parse(await readFile(process.receipt(), 'utf8'));
        assert.equal(saved.phase, 'intent'); assert.equal(saved.runId, intent.runId);
        owner.record = { ...intent, phase: 'prepared', inode: '223344' }; owner.inode = owner.record.inode;
        records.set(intent.runId, owner.record);
        if (mode === 'prepare-ack-lost') throw new Error('native-independent prepare ACK lost');
        return reply('prepared', owner.record);
      }
      if (request.op === 'start') {
        assert.equal(owner.record?.runId, intent.runId);
        owner.record = { ...owner.record!, sessionId: '$1', paneId: '%1', panePid: 3456, paneStartTicks: '78901' };
        records.set(intent.runId, owner.record);
        if (mode === 'pane-ack-lost') throw new Error('pane ACK lost');
        return reply('prepared', owner.record);
      }
      if (request.op === 'commit') {
        fixtureProject._workspace = intent.projectId;
        const saved = JSON.parse(await readFile(process.receipt(), 'utf8'));
        assert.equal(saved.panePid, owner.record!.panePid); assert.equal(saved.inode, owner.record!.inode);
        owner.record = { ...owner.record!, phase: 'running' }; records.set(intent.runId, owner.record);
        state.detached = true; state.onCommit?.();
        if (mode === 'commit-ack-lost') throw new Error('commit ACK lost after issuance');
        return reply('running', owner.record);
      }
      assert.equal(request.op, 'stop'); ++state.stopCalls;
      if (state.stopFailures-- > 0) throw new Error('independent exact cleanup connection lost');
      if (owner.record && (owner.record.runId !== intent.runId || owner.inode !== owner.record.inode ||
          intent.inode !== null && intent.inode !== owner.record.inode))
        return { code: 73, stdout: '', stderr: 'replacement domain refused' };
      const stopped = { ...(owner.record || intent), phase: 'stopped' as const };
      if (state.detached) { ++state.killed; state.detached = false; }
      records.set(intent.runId, stopped); owner.record = stopped; owner.inode = stopped.inode;
      if (mode === 'stop-ack-lost' && state.stopCalls === 1) throw new Error('full group gone; stop ACK lost');
      return reply('stopped', stopped);
    },
  }) as unknown as MachinesType;
  await mkdir(vmDir(id), { recursive: true });
  const workspaces = new Workspaces(machines, { secrets: { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ TOKEN: 'desktop-secret-雪' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ TOKEN: 'desktop-secret-雪' })`) through a Promise.
   */
  resolve: async () => ({ TOKEN: 'desktop-secret-雪' }) } as any });
  const alpha = (await workspaces.projects.create(id, '原项目', async () => {
    await workspaces.save(id, { directory: '/workspace/alpha', networkIsolation: 'private', secrets: { TOKEN: 'key' },
      environment: { HOME: '/root', DISPLAY: ':99', BASH_ENV: 'desktop-hook-$(id)' } });
  })).active;
  const beta = (await workspaces.projects.create(id, '邻居项目', async () => {
    await workspaces.save(id, { directory: '/workspace/beta', networkIsolation: 'host' });
  })).active;
  const config = await workspaces.projects.with(id, alpha, () => workspaces.config(id));
  assert.equal(Object.getOwnPropertyDescriptor(config, '_workspace')!.enumerable, false);
  const fixtureProject = { ...config };
  Object.defineProperty(fixtureProject, '_workspace', { value: alpha, enumerable: false, writable: true });
  const identity = scopeIdentityFixture(machines, fixtureProject, () => state.boot, runId => records.get(runId) || null);
  const endpoint = { plasmaPid: 1234, plasmaCreated: '5678', vncPid: 4321, vncCreated: '8765', runtimeDevice: '12',
    runtimeInode: '1234', xauthDevice: '12', xauthInode: '2345', xauthSha256: 'b'.repeat(64), readyDevice: '12', readyInode: '3456' };
  const ensureIdentity = identity.ensure;
  identity.ensure = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`value`），以 Promise 交付。
   * Result: Return the branch-computed value (`value`) through a Promise.
   * 状态影响 / State effects: `value.uid`, `value.gid`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `ensureIdentity`.
   */
  async (...args) => {
    const value = await ensureIdentity(...args);
    if (value.projectId === beta) { value.uid = 20002; value.gid = 20002; }
    return value;
  };
  const bindings = new DesktopBindings(machines);
  const options: NonNullable<ConstructorParameters<typeof ProjectDesktops>[2]> = { /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'a'.repeat(64)`），以 Promise 交付。
   * Result: Return the branch-computed value (`'a'.repeat(64)`) through a Promise.
   * 协作入口 / Collaborators: `'a'.repeat`.
   */
  build: async () => 'a'.repeat(64), readyTimeoutMs: 2000,
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: _machines; _id; op; proof。
     * 结果：返回受控对象，公开字段包括 `endpoint, guarded`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `endpoint, guarded`; the actual branch determines its shape.
     * 失败 / Failure: `new AppError('guard partial publication', 409, 'DESKTOP_SCOPE_CHANGED')`; `new AppError('original Plasma/cookie changed', 409, 'DESKTOP_SCOPE_CHANGED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `state.entered.push`, `assert.ok`, `[alpha, beta].includes`, `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.ok([alpha, beta].includes(proof.identity.projectId))`; `assert.equal(proof.identity.uid, proof.identity.projectId === alpha ? 20001 : 20002)`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    control: async (_machines, _id, op, proof) => {
      state.entered.push(op);
      assert.ok([alpha, beta].includes(proof.identity.projectId)); assert.equal(proof.identity.uid, proof.identity.projectId === alpha ? 20001 : 20002);
      assert.equal(proof.runtime, '/run/sakura-desktop-uid/' + proof.identity.uid + '/' + proof.record.runId);
      assert.ok(Buffer.byteLength(proof.runtime + '/wayland-0') < 108);
      assert.ok(!JSON.stringify(proof).includes('desktop-secret'));
      if (op === 'guard') { assert.equal(proof.run, null); if (state.guardFailure) throw new AppError('guard partial publication', 409, 'DESKTOP_SCOPE_CHANGED'); }
      if (op === 'probe') {
        ++state.probes; await state.onProbe?.();
        if (state.probeFailure || state.endpointDrift) throw new AppError('original Plasma/cookie changed', 409, 'DESKTOP_SCOPE_CHANGED');
        assert.ok(proof.run); assert.equal(proof.run.cgroupInode, proof.record.inode);
        assert.equal(proof.run.bootId, proof.record.bootId); assert.equal(proof.run.cgroupName, proof.record.scopeName);
        assert.deepEqual(proof.run, identity.tickets.get(proof.record.runId));
        if (proof.endpoint) assert.deepEqual(proof.endpoint, endpoint);
        return { endpoint };
      }
      if (op === 'unguard') {
        if (state.cleanupFailure) throw new AppError('guard retirement uncertain', 503, 'DESKTOP_CLEANUP_FAILED');
        assert.ok(!state.detached); assert.ok(!identity.tickets.get(proof.record.runId) || identity.tickets.get(proof.record.runId)!.phase === 'closed');
      }
      return { guarded: op !== 'unguard' };
    } } satisfies ConstructorParameters<typeof ProjectDesktops>[2];
  const manager = new ProjectDesktops(machines, workspaces, options);
  const pins = { projectId: alpha, live: live as unknown as NonNullable<ReturnType<MachinesType['live']['get']>> };
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: controller = new AbortController(); input: any; action: 'start' | 'configure' | 'install' | 'ime' = 'start'。
   * 结果：返回分支计算值（`manager.start(id, action, input, pins, controller.signal, () => {}, () => {})`）。
   * Result: Return the branch-computed value (`manager.start(id, action, input, pins, controller.signal, () => {}, () => {})`).
   * 协作入口 / Collaborators: `manager.start`.
   */
  const start = (controller = new AbortController(), input?: any, action: 'start' | 'configure' | 'install' | 'ime' = 'start') =>
    manager.start(id, action, input, pins, controller.signal, () => {}, () => {});
  const originalResolve = workspaces.resolveProject.bind(workspaces);
  workspaces.resolveProject = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`originalResolve(...args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`originalResolve(...args)`) through a Promise.
   * 协作入口 / Collaborators: `state.beforeResolve`, `originalResolve`.
   */
  async (...args) => { await state.beforeResolve?.(); return originalResolve(...args); };
  t.after(async () => { await workspaces.close(); });
  return { id, boot, live, alpha, beta, owner, state, records, machines, workspaces, config, identity, endpoint, bindings, manager, options, pins, start };
}

export { projectVersion, ProjectDesktops, ProjectDesktopScope, DesktopBindings, projectDesktopBindingSchema, desktopProjectCommand, desktopAdapterSource, desktopUidCommand, desktopProjectPrepare, desktopProjectEnvironment, desktopProjectImePrepare, desktopProjectImeCommand, projectIdentityPayload, assertProjectTerminalsStopped, vmDir, AppError, defaultDesktopPreferences };
