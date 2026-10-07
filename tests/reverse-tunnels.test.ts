/**
 * 模块职责：回归验证模块，围绕 `reverse-tunnels` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `reverse-tunnels`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: temporary TCP entrance forwards bytes and revokes on close, stop and lockdown; project tunnels keep independent bindings, protect configuration and preserve half-closed binary responses.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { connect } from 'node:net';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ReverseTunnels } from '../server/reverse-tunnels.ts';
import { Machines } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';
import { projectSchema, type Project, type Workspaces } from '../server/workspaces.ts';
import { reverseTunnelIdentityOptions } from './reverse-tunnel-identity-fixture.ts';

const id = '11111111-1111-4111-8111-111111111111';

class Guest extends EventEmitter {
  running = true;
  live = new Map([[id, {}]]);
  locks = new Machines({} as Engine, fakeVmNetwork);
  locked = this.locks.locked.bind(this.locks);
  commands: string[] = [];
  forwarded: Project[] = [];
  hanging = false;
  routeError = false;
  reservations = new Map<string, number[]>();
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`this.running ? 'running' : 'stopped'`）。
   * Result: Return the branch-computed value (`this.running ? 'running' : 'stopped'`).
   */
  state() { return this.running ? 'running' : 'stopped'; }
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `distro`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `distro`; the actual branch determines its shape.
   */
  get() { return { distro: 'alpine' }; }
  /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  requireUnlocked() {}
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: owner: string; ports: number[]。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `this.reservations.set`.
   */
  reserveHostPorts(owner: string, ports: number[]) { this.reservations.set(owner, ports); }
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; command: string; _timeout: number; signal: AbortSignal。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `this.commands.push`, `delay`.
   */
  async exec(_id: string, command: string, _timeout?: number, signal?: AbortSignal) {
    this.commands.push(command);
    if (this.hanging) await delay(60_000, undefined, { signal });
    return { code: 0, stdout: '', stderr: '' };
  }
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; _port: number; signal: AbortSignal; project: Project。
   * 结果：返回分支计算值（`stream`），以 Promise 交付。
   * Result: Return the branch-computed value (`stream`) through a Promise.
   * 失败 / Failure: `new Error('项目命名空间已有网络路由')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `this.forwarded.push`, `signal?.addEventListener`.
   */
  async openGuestTcpStream(_id: string, _port: number, signal?: AbortSignal, project?: Project) {
    if (this.routeError) throw new Error('项目命名空间已有网络路由');
    this.forwarded.push(project!);
    const stream = new PassThrough();
    signal?.addEventListener('abort', () => stream.destroy(), { once: true });
    return stream;
  }
}

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `workspaces, guards, configs, alpha, beta, inScope`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `workspaces, guards, configs, alpha, beta, inScope`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `projectSchema.parse`, `Object.defineProperty`.
 */
function workspace() {
  const context = new AsyncLocalStorage<string>(), guards = new Set</**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: id: string; previous: Project; next: Project。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (id: string, previous: Project, next: Project) => Promise<void>>();
  const alpha = '0123456789abcdef', beta = 'fedcba9876543210';
  const configs = new Map<string, Project>([
    ['default', projectSchema.parse({ directory: '/workspace/default' })],
    [alpha, { ...projectSchema.parse({ directory: '/workspace/alpha', networkIsolation: 'private',
      environment: { TOKEN: 'private-tunnel-value' }, secrets: { TOKEN: 'tunnel-key' } }), _workspace: alpha }],
    [beta, { ...projectSchema.parse({ directory: '/workspace/beta', networkIsolation: 'private' }), _workspace: beta }],
  ]);
  for (const [scope, project] of configs) Object.defineProperty(project, '_workspace',
    { value: scope === 'default' ? undefined : scope, enumerable: false, writable: true, configurable: true });
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`configs.get(context.getStore() || 'default')!`），以 Promise 交付。
   * Result: Return the branch-computed value (`configs.get(context.getStore() || 'default')!`) through a Promise.
   * 协作入口 / Collaborators: `configs.get`, `context.getStore`.
   */
  const config = async () => configs.get(context.getStore() || 'default')!;
  const workspaces = { config, resolvedConfig: config, /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: _id: string; project: Project。
   * 结果：返回分支计算值（`project`），以 Promise 交付。
   * Result: Return the branch-computed value (`project`) through a Promise.
   */
  resolveProject: async (_id: string, project: Project) => project,
    projects: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`context.getStore() || 'default'`）。
     * Result: Return the branch-computed value (`context.getStore() || 'default'`).
     * 协作入口 / Collaborators: `context.getStore`.
     */
    current: () => context.getStore() || 'default',
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: _id: string; project: string; action: () => T。
       * 结果：返回分支计算值（`context.run(project, action)`）。
       * Result: Return the branch-computed value (`context.run(project, action)`).
       * 协作入口 / Collaborators: `context.run`.
       */
      inScope: <T>(_id: string, project: string, action: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      () => T) => context.run(project, action) },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: guard: (id: string, previous: Project, next: Project) => Promise<void>。
     * 结果：返回分支计算值（`() => guards.delete(guard)`）。
     * Result: Return the branch-computed value (`() => guards.delete(guard)`).
     * 协作入口 / Collaborators: `guards.add`.
     */
    beforeConfigChange: (guard: /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: id: string; previous: Project; next: Project。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (id: string, previous: Project, next: Project) => Promise<void>) => {
      guards.add(guard); return () => guards.delete(guard);
    },
  } as unknown as Workspaces;
  return { workspaces, guards, configs, alpha, beta,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: project: string; action: () => T。
     * 结果：返回分支计算值（`context.run(project, action)`）。
     * Result: Return the branch-computed value (`context.run(project, action)`).
     * 协作入口 / Collaborators: `context.run`.
     */
    inScope: <T>(project: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => T) => context.run(project, action) };
}

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: port: number。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(new Promise<void>((resolve, reject) => { const socket = connect(port, '127.0.0.1'); socket.once('connect', () => { …`.
 */
async function rejected(port: number) {
  await assert.rejects(new Promise<void>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', reject);
  }));
}

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: predicate: () => boolean。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `predicate`, `delay`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(predicate(), true)`.
 */
async function eventually(predicate: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => boolean) {
  for (let attempt = 0; attempt < 50 && !predicate(); attempt++) await delay(10);
  assert.equal(predicate(), true);
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: temporary TCP entrance forwards bytes and revokes on close, stop and lockdown
 * 状态影响 / State effects: `guest.running`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `workspace`, `reverseTunnelIdentityOptions`, `assert.equal`, `tunnels.check`.
 * 检查边界 / Checked boundaries: `assert.equal((await tunnels.check(id)).ready, true)`; `assert.rejects(tunnels.open(id, 0, 10), /端口/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('temporary TCP entrance forwards bytes and revokes on close, stop and lockdown', async t => {
  const guest = new Guest();
  const scope = workspace(), model = await reverseTunnelIdentityOptions(t, guest as unknown as Machines, scope.workspaces);
  const tunnels = new ReverseTunnels(guest as unknown as Machines, scope.workspaces, model.options);
  try {
    assert.equal((await tunnels.check(id)).ready, true);
    await assert.rejects(tunnels.open(id, 0, 10), /端口/);
    const opened = await tunnels.open(id, 8765, 10);
    assert.equal(opened.active, true);
    assert.ok(opened.localPort);
    const socket = connect(opened.localPort!, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    socket.write('ping');
    const [echo] = await once(socket, 'data');
    assert.equal(echo.toString(), 'ping');
    assert.equal(tunnels.status(id).active, true);
    assert.equal(await tunnels.stop(id), true);
    await eventually(() => socket.destroyed);
    await rejected(opened.localPort!);

    const stopped = await tunnels.open(id, 8765, 10);
    guest.running = false;
    guest.emit('change');
    await assert.rejects(tunnels.stop(id), (error: any) => error.status === 503);
    assert.equal((await tunnels.check(id)).ready, false);
    assert.equal(tunnels.status(id).active, false);
    await rejected(stopped.localPort!);

    guest.running = true;
    await tunnels.stop(id);
    const locked = await tunnels.open(id, 8765, 10);
    guest.emit('incident-lockdown', id);
    await tunnels.stop(id);
    assert.equal(tunnels.status(id).active, false);
    await rejected(locked.localPort!);
  } finally {
    await tunnels.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: project tunnels keep independent bindings, protect configuration and preserve half-closed binary responses
 * 状态影响 / State effects: `guest.routeError`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `workspace`, `reverseTunnelIdentityOptions`, `scope.inScope`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(first.projectId, scope.alpha)`; `assert.equal(first.networkIsolation, 'private')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('project tunnels keep independent bindings, protect configuration and preserve half-closed binary responses', async t => {
  const guest = new Guest(), scope = workspace();
  const model = await reverseTunnelIdentityOptions(t, guest as unknown as Machines, scope.workspaces);
  const tunnels = new ReverseTunnels(guest as unknown as Machines, scope.workspaces, model.options);
  try {
    const first = await scope.inScope(scope.alpha, () => tunnels.open(id, 8765, 10));
    const second = await scope.inScope(scope.beta, () => tunnels.open(id, 8765, 10));
    assert.equal(first.projectId, scope.alpha);
    assert.equal(first.networkIsolation, 'private');
    assert.notEqual(first.localPort, second.localPort);
    assert.equal(tunnels.status(id).active, false);
    assert.equal(await tunnels.stop(id), false, 'another project cannot close these tunnels');
    await assert.rejects(scope.inScope(scope.alpha, () => tunnels.open(id, 8766, 10)), /此项目已有/);
    const previous = scope.configs.get(scope.alpha)!;
    for (const guard of scope.guards) {
      await assert.rejects(guard(id, previous, { ...previous, networkIsolation: 'host' }), /先关闭.*隧道/);
      await guard(id, previous, { ...previous, environment: { TOKEN: 'new' } });
    }
    const socket = connect(first.localPort, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    const ended = once(socket, 'end');
    const bytes = Buffer.alloc(256 * 1024, 137);
    socket.end(bytes); await ended;
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.equal(guest.forwarded[0]._workspace, scope.alpha);
    assert.equal(guest.forwarded[0].environment, undefined);
    assert.equal(guest.forwarded[0].secrets, undefined);
    assert.equal(model.tickets.get(model.records.get(scope.alpha)!.runId)!.namespace, 'sk-' + scope.alpha);
    assert.ok(model.frames.length === 2 && model.rootLaunches.every(command => !command.includes('private-tunnel-value')));
    scope.configs.set(scope.alpha, { ...previous, networkIsolation: 'host' });
    const changed = connect(first.localPort, '127.0.0.1');
    changed.on('error', () => {});
    await once(changed, 'close');
    assert.equal(guest.forwarded.length, 1, 'a changed binding cannot fall back to shared networking');
    scope.configs.set(scope.alpha, previous);
    guest.routeError = true;
    const routes = connect(first.localPort, '127.0.0.1');
    routes.on('error', () => {}); await once(routes, 'close');
    assert.equal(guest.forwarded.length, 1);
    guest.emit('incident-lockdown', id);
    await tunnels.close();
    await rejected(first.localPort); await rejected(second.localPort);
  } finally { await tunnels.close(); }
  assert.equal(scope.guards.size, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: shutdown aborts an unfinished tunnel setup and releases the instance lock
 * 状态影响 / State effects: `guest.hanging`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `workspace`, `reverseTunnelIdentityOptions`, `scope.inScope`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(operation, /abort/i)`; `assert.equal(guest.reservations.size, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('shutdown aborts an unfinished tunnel setup and releases the instance lock', async t => {
  const guest = new Guest(), scope = workspace(); guest.hanging = true;
  const model = await reverseTunnelIdentityOptions(t, guest as unknown as Machines, scope.workspaces);
  const tunnels = new ReverseTunnels(guest as unknown as Machines, scope.workspaces, model.options);
  const operation = scope.inScope(scope.alpha, () => tunnels.open(id, 8765, 10));
  const rejected = assert.rejects(operation, /abort/i);
  await eventually(() => guest.commands.length > 0);
  await tunnels.close(); await rejected;
  assert.equal(guest.reservations.size, 0);
  await guest.locked(id, async () => {});
  await assert.rejects(tunnels.open(id, 8765, 10), /已关闭/);
});
