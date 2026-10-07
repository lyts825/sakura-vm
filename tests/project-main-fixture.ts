/**
 * 模块职责：共享测试夹具模块，围绕 `project-main-fixture` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Shared test fixture for `project-main-fixture`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 */
import { projectMetadataFile } from '../server/project-catalog.ts';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Machines } from '../server/machines.ts';
import { ProjectMainScope, ProjectServiceScopes, type ProjectMainRecord, type ProjectServiceRecord } from '../server/project-service-scope.ts';
import { projectSchema, Workspaces } from '../server/workspaces.ts';
import { writeStore } from '../server/local-store.ts';
import { scopeIdentityFixture } from './project-scope-identity-fixture.ts';

/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: command: string。
 * 结果：返回受控对象，公开字段包括 `kind`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `kind`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `command.split('\n').find`, `command.split`, `line.startsWith`, `JSON.parse`.
 */
export function scopeRequest(command: string) {
  const line = command.split('\n').find(value => /^# SAKURA_PROJECT_(MAIN|SERVICE)_REQUEST=/.test(value));
  if (!line) return null;
  return { kind: line.startsWith('# SAKURA_PROJECT_MAIN_') ? 'main' : 'service',
    ...JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString()) };
}
/**
 * 中文功能：组合项目主命令作用域、真实工作区配置和身份夹具，向用例提供持久意图、启动及服务启动的受控入口。
 * English: Combine main-command scopes, real workspace configuration and the identity fixture, exposing controlled intent persistence, main launch and service launch.
 * 输入 / Inputs: mode = 'normal'。
 * 结果：返回受控对象，公开字段包括 `id, bootId, project, machines, scope, spaces, state, events, commands`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, bootId, project, machines, scope, spaces, state, events, commands`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `projectSchema.parse`, `Object.assign`, `scopeIdentityFixture`.
 * 设计思路：先持久化意图，再取得匹配身份正文并启动；把启动代次、机器状态、清理失败和原记录独立暴露，便于证明失败后保留原票据，而非靠“机器已停止”推断清理完成。
 * Design: Persist intent before obtaining its matching identity payload and launching. Expose boot generation, machine state, cleanup faults and original records separately so tests prove receipt retention instead of inferring cleanup from a stopped machine.
 */
export async function mainFixture(mode = 'normal') {
  const id = randomUUID(), bootId = randomUUID(), controller = new AbortController();
  const project = projectSchema.parse({ directory: '/workspace', command: 'sleep 600', networkIsolation: 'private',
    environment: { TOKEN: 'owned-main-private-token' }, secrets: { TOKEN: 'main-token' } });
  const state = { main: null as ProjectMainRecord | null, services: new Map<string, ProjectServiceRecord>(),
    machine: 'running', stopAttempts: 0, stopped: 0, commits: 0, prepared: 0, sequence: 0, namespaceRemovals: 0,
    currentBoot: bootId, rebootProbes: 0, rebootBlock: '', rebootProbeFailures: 0 };
  const events: { kind: string; op: string; record?: unknown }[] = [], commands: string[] = [];
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([[id, {}]]), records: new Map([[id, { id, distro: 'alpine' }]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id, distro: 'alpine' })`）。
     * Result: Return the branch-computed value (`({ id, distro: 'alpine' })`).
     */
    get: () => ({ id, distro: 'alpine' }), /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`state.machine`）。
     * Result: Return the branch-computed value (`state.machine`).
     */
    state: () => state.machine,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; action: () => Promise<unknown>。
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
    () => Promise<unknown>) => action(),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 失败 / Failure: `new Error('owned-main-private-token reboot connection failed')`; `new Error('owned-main-private-token prepare reply lost')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `commands.push`, `scopeRequest`, `command.startsWith`, `command.includes`.
     * 检查边界 / Checked boundaries: `assert.equal(host.runId, input.record.runId)`; `assert.equal(host.phase, 'intent')`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      const input = scopeRequest(command);
      if (!input) {
        if (command.startsWith('# SAKURA_PROJECT_MAIN_LEGACY_STATUS'))
          return { code: 0, stdout: mode === 'legacy' ? 'unmanaged' : 'absent', stderr: '' };
        if (command.startsWith('# SAKURA_PROJECT_RUNTIME_LOG'))
          return { code: 0, stdout: 'owned main application log owned-main-private-token', stderr: '' };
        if (command.startsWith('if ip netns exec') && command.includes('ip netns del')) ++state.namespaceRemovals;
        return { code: 0, stdout: '', stderr: '' };
      }
      const { kind, op } = input;
      events.push({ kind, op, record: input.record });
      /**
       * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
       * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`kind === 'main' ? state.main : state.services.get(input.name) || null`）。
       * Result: Return the branch-computed value (`kind === 'main' ? state.main : state.services.get(input.name) || null`).
       * 协作入口 / Collaborators: `state.services.get`.
       */
      const record = () => kind === 'main' ? state.main : state.services.get(input.name) || null;
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: value: ProjectMainRecord | ProjectServiceRecord。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 状态影响 / State effects: `state.main`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `state.services.set`.
       */
      const save = (value: ProjectMainRecord | ProjectServiceRecord) => {
        if (value.version === 2) state.main = value;
        else state.services.set(value.name, value);
      };
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: status: string; value = record()。
       * 结果：返回分支计算值（`({ code: 0, stdout: JSON.stringify({ status, bootId, record: value }), stderr: '…`）。
       * Result: Return the branch-computed value (`({ code: 0, stdout: JSON.stringify({ status, bootId, record: value }), stderr: '…`).
       * 协作入口 / Collaborators: `JSON.stringify`.
       */
      const reply = (status: string, value = record()) => ({ code: 0, stdout: JSON.stringify({ status, bootId, record: value }), stderr: '' });
      if (op === 'probe-reboot') {
        ++state.rebootProbes;
        if (state.rebootProbes <= state.rebootProbeFailures) throw new Error('owned-main-private-token reboot connection failed');
        if (state.currentBoot !== input.record.bootId && (state.main || state.rebootBlock))
          return { code: 73, stdout: '', stderr: state.rebootBlock || 'new guest owner exists' };
        return { code: 0, stdout: JSON.stringify({ bootId: state.currentBoot, retired: state.currentBoot !== input.record.bootId }), stderr: '' };
      }
      if (op === 'status') {
        if (kind === 'main' && mode === 'legacy') return reply('unmanaged', null);
        if (kind === 'main' && mode === 'unconfirmed') return { code: 73, stdout: '', stderr: 'owned-main-private-token ownership mismatch' };
        if (kind === 'main' && mode === 'malformed-status') return reply('running', null);
        return reply(record()?.phase === 'running' && kind === 'main' && mode === 'exited' ? 'exited' : record()?.phase || 'absent');
      }
      if (op === 'prepare') {
        const scope = kind === 'main' ? new ProjectMainScope(machines as unknown as Machines, id, project)
          : new ProjectServiceScopes(machines as unknown as Machines, id, project);
        const file = kind === 'main' ? (scope as ProjectMainScope).receipt()
          : (scope as ProjectServiceScopes).receipt(input.name);
        const host = JSON.parse(await readFile(file, 'utf8'));
        assert.equal(host.runId, input.record.runId);
        assert.equal(host.phase, 'intent');
        assert.equal(JSON.stringify(host).includes('owned-main-private-token'), false);
        if (kind === 'main') { assert.equal(host.kind, 'main'); assert.equal('name' in host, false); }
        if (kind === 'main' && mode === 'unavailable')
          return { code: 73, stdout: '', stderr: 'SAKURA_PROJECT_MAIN_SCOPE_UNAVAILABLE: readonly cgroup' };
        const prepared = { ...input.record, phase: 'prepared', inode: '1000' + ++state.sequence };
        save(prepared); ++state.prepared;
        if (kind === 'main' && mode === 'prepare-ack-lost') throw new Error('owned-main-private-token prepare reply lost');
        return reply('prepared', prepared);
      }
      if (op === 'start') {
        const pane = { ...record()!, sessionId: '$' + state.sequence, paneId: '%' + state.sequence,
          panePid: 100 + state.sequence, paneStartTicks: '999' + state.sequence };
        save(pane);
        if (kind === 'main' && mode === 'pane-ack-lost') throw new Error('owned-main-private-token pane reply lost');
        return reply('prepared', pane);
      }
      if (op === 'commit') {
        const file = kind === 'main' ? new ProjectMainScope(machines as unknown as Machines, id, project).receipt()
          : new ProjectServiceScopes(machines as unknown as Machines, id, project).receipt(input.name);
        const host = JSON.parse(await readFile(file, 'utf8'));
        assert.equal(host.inode, record()!.inode); assert.equal(host.panePid, record()!.panePid); assert.equal(host.phase, 'prepared');
        const committed = { ...record()!, phase: 'running' as const };
        save(committed); ++state.commits;
        if (kind === 'main' && mode === 'commit-ack-lost') throw new Error('owned-main-private-token commit reply lost');
        if (kind === 'main' && (mode === 'cancel-after-commit' || mode === 'cancel-cleanup-failed')) controller.abort(new Error('owned cancellation'));
        return reply('running', committed);
      }
      assert.equal(op, 'stop'); ++state.stopAttempts;
      if (kind === 'main' && (mode === 'all-stop-failures' || mode === 'cancel-cleanup-failed' ||
        (mode === 'first-stop-failure' && state.stopAttempts === 1))) throw new Error('owned-main-private-token cleanup connection failed');
      if (kind === 'main' && mode === 'replace-live') {
        machines.live.set(id, {} as NonNullable<ReturnType<Machines['live']['get']>>);
        throw new Error('owned live replacement');
      }
      const actual = record();
      if (actual) {
        for (const key of ['runId', 'bootId', 'scopeName', 'binding'])
          if (actual[key as keyof typeof actual] !== input.record[key]) return { code: 73, stdout: '', stderr: 'owned guest run identity mismatch' };
        for (const key of ['inode', 'sessionId', 'paneId', 'panePid', 'paneStartTicks'])
          if (input.record[key] !== null && actual[key as keyof typeof actual] !== input.record[key])
            return { code: 73, stdout: '', stderr: 'owned guest pane identity mismatch' };
      }
      const stopped = { ...(actual || input.record), phase: 'stopped' as const };
      save(stopped); ++state.stopped;
      if (kind === 'main' && mode === 'stop-ack-lost' && state.stopAttempts === 1) throw new Error('owned stopped receipt ACK lost');
      return reply('stopped', stopped);
    },
  }) as unknown as Machines;
  const identity = scopeIdentityFixture(machines, project, () => state.currentBoot,
    runId => state.main?.runId === runId ? state.main : [...state.services.values()].find(item => item.runId === runId) || null);
  const scope = new ProjectMainScope(machines, id, project);
  const spaces = new Workspaces(machines, { secrets: { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ TOKEN: 'owned-main-private-token' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ TOKEN: 'owned-main-private-token' })`) through a Promise.
   */
  resolve: async () => ({ TOKEN: 'owned-main-private-token' }) } as any });
  await writeStore(projectMetadataFile(id, spaces.projects.current(id)), project);
  return { id, bootId, project, machines, scope, spaces, state, events, commands, controller, identity,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`scope.start(intent, await identity.payload(id, intent), controller.signal)`），以 Promise 交付。
     * Result: Return the branch-computed value (`scope.start(intent, await identity.payload(id, intent), controller.signal)`) through a Promise.
     * 协作入口 / Collaborators: `scope.intent`, `scope.persistIntent`, `scope.start`, `identity.payload`.
     */
    startMain: async () => {
      const intent = scope.intent(state.currentBoot);
      await scope.persistIntent(intent);
      return scope.start(intent, await identity.payload(id, intent), controller.signal);
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: services: ProjectServiceScopes; record: ProjectServiceRecord。
     * 结果：返回分支计算值（`services.start(record, await identity.payload(id, record, { command: 'sleep 600'…`），以 Promise 交付。
     * Result: Return the branch-computed value (`services.start(record, await identity.payload(id, record, { command: 'sleep 600'…`) through a Promise.
     * 协作入口 / Collaborators: `services.persistIntent`, `services.start`, `identity.payload`.
     */
    startService: async (services: ProjectServiceScopes, record: ProjectServiceRecord) => {
      await services.persistIntent(record);
      return services.start(record, await identity.payload(id, record, { command: 'sleep 600' }), controller.signal);
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: unknown。
     * 结果：返回分支计算值（`writeStore(projectMetadataFile(id, spaces.projects.current(id)), value)`），以 Promise 交付。
     * Result: Return the branch-computed value (`writeStore(projectMetadataFile(id, spaces.projects.current(id)), value)`) through a Promise.
     * 协作入口 / Collaborators: `writeStore`, `projectMetadataFile`, `spaces.projects.current`.
     */
    saveConfig: async (value: unknown) => writeStore(projectMetadataFile(id, spaces.projects.current(id)), value) };
}
