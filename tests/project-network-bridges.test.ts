/**
 * 模块职责：回归验证模块，围绕 `project-network-bridges` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-network-bridges`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: private loopback bridge carries binary streams, validates each namespace connection and revokes on lifecycle changes; bridge failures release the requested host port, and shutdown cancels a pending namespace probe.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { connect, createServer } from 'node:net';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { ClientChannel } from 'ssh2';
import type { Machines } from '../server/machines.ts';
import type { Project } from '../server/workspaces.ts';
import { ProjectNetworkBridges } from '../server/project-network-bridges.ts';
import { freePort } from '../server/qmp.ts';

const id = '11111111-1111-4111-8111-111111111111';
const project = { directory: '/workspace', template: 'none', networkIsolation: 'private',
  _workspace: '0123456789abcdef' } as Project;

class Guest extends EventEmitter {
  running = true;
  locked = false;
  clients = new Set<EventEmitter>();
  commands: string[] = [];
  reservations = new Map<string, number[]>();
  probeCode = 0;
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`this.running ? 'running' : 'stopped'`）。
   * Result: Return the branch-computed value (`this.running ? 'running' : 'stopped'`).
   */
  state() { return this.running ? 'running' : 'stopped'; }
  /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 失败 / Failure: `new Error('locked')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  requireUnlocked() { if (this.locked) throw new Error('locked'); }
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: owner: string; ports: number[]。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `this.reservations.set`, `this.reservations.delete`.
   */
  reserveHostPorts(owner: string, ports: number[]) {
    if (ports.length) this.reservations.set(owner, ports); else this.reservations.delete(owner);
  }
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; command: string。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `this.commands.push`.
   */
  async exec(_id: string, command: string) {
    this.commands.push(command);
    return { code: this.probeCode, stdout: '', stderr: this.probeCode ? 'bad routes' : '' };
  }
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; _timeout: number; signal: AbortSignal。
   * 结果：返回分支计算值（`Object.assign(client, { destroy: () => { this.clients.delete(client); client.emi…`），以 Promise 交付。
   * Result: Return the branch-computed value (`Object.assign(client, { destroy: () => { this.clients.delete(client); client.emi…`) through a Promise.
   * 协作入口 / Collaborators: `signal?.throwIfAborted`, `this.clients.add`, `Object.assign`.
   */
  async connect(_id: string, _timeout: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const client = new EventEmitter();
    this.clients.add(client);
    return Object.assign(client, {
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `this.clients.delete`, `client.emit`.
       */
      destroy: () => { this.clients.delete(client); client.emit('close'); },
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: command: string; callback: (error: Error | undefined, channel: ClientChannel) => void。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `this.commands.push`, `Object.assign`, `client.once`, `callback`.
       */
      exec: (command: string, callback: /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: error: Error | undefined; channel: ClientChannel。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      (error: Error | undefined, channel: ClientChannel) => void) => {
        this.commands.push(command);
        const stream = Object.assign(new PassThrough(), { stderr: new PassThrough() });
        client.once('close', () => stream.destroy());
        callback(undefined, stream as unknown as ClientChannel);
      },
    });
  }
}

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: check: () => boolean。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `check`, `delay`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(check(), true)`.
 */
async function eventually(check: /**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await delay(10);
  assert.equal(check(), true);
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
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private loopback bridge carries binary streams, validates each namespace connection and revokes on lifecycle changes
 * 状态影响 / State effects: `guest.running`, `guest.locked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `assert.rejects`, `bridges.open`, `freePort`, `Promise.all`.
 * 检查边界 / Checked boundaries: `assert.rejects(bridges.open(id, { ...project, networkIsolation: 'host' }, 8888, 18888), /私有/)`; `assert.rejects(bridges.open(id, project, 8888, 0), /端口/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('private loopback bridge carries binary streams, validates each namespace connection and revokes on lifecycle changes', async () => {
  const guest = new Guest();
  const bridges = new ProjectNetworkBridges(guest as unknown as Machines);
  try {
    await assert.rejects(bridges.open(id, { ...project, networkIsolation: 'host' }, 8888, 18888), /私有/);
    await assert.rejects(bridges.open(id, project, 8888, 0), /端口/);
    const port = await freePort();
    await Promise.all([bridges.open(id, project, 8888, port), bridges.open(id, project, 8888, port)]);
    assert.equal(guest.reservations.size, 1);
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    const response = once(socket, 'data');
    socket.write(Buffer.from([0, 255, 13, 10, 128]));
    assert.deepEqual((await response)[0], Buffer.from([0, 255, 13, 10, 128]));
    assert.equal(guest.clients.size, 1);
    const command = guest.commands.at(-1)!;
    assert.match(command, /ip netns exec sk-0123456789abcdef/);
    assert.match(command, /sakura_ipv4=/);
    assert.match(command, /sakura_ipv6=/);
    assert.match(command, /exec python3 -I -S -u/);
    assert.match(command, /127\.0\.0\.1/);
    const halfClosed = connect(port, '127.0.0.1');
    halfClosed.on('error', () => {});
    await once(halfClosed, 'connect');
    const chunks: Buffer[] = [];
    halfClosed.on('data', (data) => chunks.push(data));
    const ended = once(halfClosed, 'end');
    const payload = Buffer.alloc(256 * 1024, 137);
    halfClosed.end(payload);
    await ended;
    assert.deepEqual(Buffer.concat(chunks), payload,
      'a TCP half-close must flush the response before destroying SSH');
    await eventually(() => halfClosed.destroyed && guest.clients.size === 1);
    await assert.rejects(bridges.open(id, project, 9999, port), /先关闭/);
    guest.running = false;
    guest.emit('change');
    await bridges.stop(id, project._workspace!);
    await eventually(() => socket.destroyed && guest.clients.size === 0);
    assert.equal(guest.reservations.size, 0);
    await rejected(port);
    guest.running = true;
    await bridges.open(id, project, 8888, port);
    guest.locked = true;
    guest.emit('incident-lockdown', id);
    await bridges.stop(id, project._workspace!);
    await rejected(port);
    await assert.rejects(bridges.open(id, project, 8888, port), /locked/);
  } finally { await bridges.close(); }
  await assert.rejects(bridges.open(id, project, 8888, 18888), /已关闭/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: bridge failures release the requested host port, and shutdown cancels a pending namespace probe
 * 状态影响 / State effects: `guest.probeCode`, `guest.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `freePort`, `assert.rejects`, `bridges.open`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(bridges.open(id, project, 8888, port), /bad routes/)`; `assert.equal(guest.reservations.size, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('bridge failures release the requested host port, and shutdown cancels a pending namespace probe', async () => {
  const guest = new Guest();
  const bridges = new ProjectNetworkBridges(guest as unknown as Machines);
  const port = await freePort();
  try {
    guest.probeCode = 1;
    await assert.rejects(bridges.open(id, project, 8888, port), /bad routes/);
    assert.equal(guest.reservations.size, 0);
    await rejected(port);
    guest.probeCode = 0;
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(port, '127.0.0.1', resolve));
    try {
      await assert.rejects(bridges.open(id, project, 8888, port), /EADDRINUSE/);
      assert.equal(guest.reservations.size, 0);
    } finally { await new Promise<void>((resolve) => occupied.close(() => resolve())); }
    guest.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; _command: string; _timeout: number; signal: AbortSignal。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: bridge failures release the requested host port, and shutdown cancels a pending namespace probe
     * 协作入口 / Collaborators: `delay`.
     */
    async (_id: string, _command: string, _timeout?: number, signal?: AbortSignal) => {
      await delay(60_000, undefined, { signal });
      return { code: 0, stdout: '', stderr: '' };
    };
    const opening = bridges.open(id, project, 8888, port);
    const failure = assert.rejects(opening, /abort/i);
    await eventually(() => guest.reservations.size === 1);
    await bridges.close();
    await failure;
    assert.equal(guest.reservations.size, 0);
    await rejected(port);
  } finally { await bridges.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a late SSH connection is destroyed when its local bridge has already been revoked
 * 状态影响 / State effects: `guest.connect`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `guest.connect.bind`, `freePort`, `bridges.open`, `connect`.
 * 检查边界 / Checked boundaries: `assert.equal(guest.reservations.size, 0)`; `assert.equal(guest.commands.some((command) => command.includes('python3 -I -S -u')), false, 'a cancelled connection must never exe…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a late SSH connection is destroyed when its local bridge has already been revoked', async () => {
  const guest = new Guest();
  const original = guest.connect.bind(guest);
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  let connecting = false;
  let supplied = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  guest.connect = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: vmId: string; timeout: number。
   * 结果：返回分支计算值（`client`），以 Promise 交付。
   * Result: Return the branch-computed value (`client`) through a Promise.
   * 验证场景 / Scenario: a late SSH connection is destroyed when its local bridge has already been revoked
   * 状态影响 / State effects: `connecting`, `supplied`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `original`.
   */
  async (vmId: string, timeout: number) => {
    connecting = true;
    await gate;
    const client = await original(vmId, timeout);
    supplied = true;
    return client;
  };
  const bridges = new ProjectNetworkBridges(guest as unknown as Machines);
  try {
    const port = await freePort();
    await bridges.open(id, project, 8888, port);
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    await eventually(() => connecting);
    await bridges.stop(id, project._workspace!);
    release();
    await eventually(() => supplied && socket.destroyed && guest.clients.size === 0);
    assert.equal(guest.reservations.size, 0);
    await rejected(port);
    assert.equal(guest.commands.some((command) => command.includes('python3 -I -S -u')), false,
      'a cancelled connection must never execute the relay');
  } finally { release(); await bridges.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: project runtime validation rejects stale new connections and repeated opens without executing a relay
 * 状态影响 / State effects: `valid`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `freePort`, `assert.rejects`, `bridges.open`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(bridges.open(id, project, 8888, port), /binding changed/)`; `assert.equal(guest.reservations.size, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('project runtime validation rejects stale new connections and repeated opens without executing a relay', async () => {
  const guest = new Guest();
  let valid = false, checks = 0;
  const bridges = new ProjectNetworkBridges(guest as unknown as Machines, async () => {
    checks++;
    if (!valid) throw new Error('runtime binding changed');
  });
  const port = await freePort();
  try {
    await assert.rejects(bridges.open(id, project, 8888, port), /binding changed/);
    assert.equal(guest.reservations.size, 0);
    await rejected(port);
    valid = true;
    await bridges.open(id, project, 8888, port);
    valid = false;
    await assert.rejects(bridges.open(id, project, 8888, port), /binding changed/);
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    await eventually(() => socket.destroyed);
    assert.equal(checks, 4);
    assert.equal(guest.clients.size, 0);
    assert.equal(guest.commands.some((command) => command.includes('python3 -I -S -u')), false);
  } finally { await bridges.close(); }
  assert.equal(guest.reservations.size, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an explicitly allowed shared project bridge is separately stopped and still validates its runtime
 * 协作入口 / Collaborators: `freePort`, `bridges.open`, `assert.equal`, `connect`.
 * 检查边界 / Checked boundaries: `assert.equal(checks, 1)`; `assert.equal((await response)[0].toString(), 'shared')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('an explicitly allowed shared project bridge is separately stopped and still validates its runtime', async () => {
  const guest = new Guest();
  let checks = 0;
  const shared = { ...project, networkIsolation: 'host' as const };
  const bridges = new ProjectNetworkBridges(guest as unknown as Machines, async () => { checks++; });
  const port = await freePort();
  try {
    await bridges.open(id, shared, 8888, port, undefined, true);
    assert.equal(checks, 1);
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    const response = once(socket, 'data');
    socket.write('shared');
    assert.equal((await response)[0].toString(), 'shared');
    assert.equal(checks, 3);
    assert.ok(guest.commands.every((command) => !command.includes('ip netns exec')));
    await bridges.stop(id, shared._workspace!);
    await eventually(() => socket.destroyed && guest.clients.size === 0);
    await rejected(port);
  } finally { await bridges.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a changed guest boot during SSH connect is revalidated before any HTTP relay command
 * 状态影响 / State effects: `guest.connect`, `valid`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `guest.connect.bind`, `freePort`, `bridges.open`, `connect`.
 * 检查边界 / Checked boundaries: `assert.equal(guest.commands.some(command => command.includes('python3 -I -S -u')), false, 'the authenticated SSH connection must n…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a changed guest boot during SSH connect is revalidated before any HTTP relay command', async () => {
  const guest = new Guest();
  let valid = true, connecting = false; let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = guest.connect.bind(guest);
  guest.connect = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: vmId; timeout; signal。
   * 结果：返回分支计算值（`original(vmId, timeout, signal)`），以 Promise 交付。
   * Result: Return the branch-computed value (`original(vmId, timeout, signal)`) through a Promise.
   * 验证场景 / Scenario: a changed guest boot during SSH connect is revalidated before any HTTP relay command
   * 状态影响 / State effects: `connecting`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `original`.
   */
  async (vmId, timeout, signal) => { connecting = true; await gate; return original(vmId, timeout, signal); };
  const bridges = new ProjectNetworkBridges(guest as unknown as Machines, async () => {
    if (!valid) throw new Error('original guest boot changed');
  });
  try {
    const port = await freePort(); await bridges.open(id, project, 8888, port);
    const socket = connect(port, '127.0.0.1'); socket.on('error', () => {}); await once(socket, 'connect');
    await eventually(() => connecting); valid = false; release();
    await eventually(() => socket.destroyed && guest.clients.size === 0);
    assert.equal(guest.commands.some(command => command.includes('python3 -I -S -u')), false,
      'the authenticated SSH connection must not start a relay after its original boot proof changed');
  } finally { release(); await bridges.close(); }
});
