/**
 * 模块职责：回归验证模块，围绕 `desktop-connection` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `desktop-connection`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: a disconnected desktop reconnects without replacing the guest session; a connection constructor failure uses the same bounded reconnect path.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { connectDesktop } from '../src/desktop-connection.ts';

class Client extends EventTarget {
  disconnects = 0;
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `this.emit`.
   */
  disconnect() {
    this.disconnects++;
    this.emit('disconnect');
  }
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: event: string。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `this.dispatchEvent`.
   */
  emit(event: string) {
    this.dispatchEvent(new Event(event));
  }
}

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext。
 * 结果：返回受控对象，公开字段包括 `clients, states`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `clients, states`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `t.mock.timers.enable`, `connectDesktop`, `t.after`.
 */
function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clients: Client[] = [];
  const states: { connected: boolean; message: string; error?: string }[] = [];
  const controller = connectDesktop(
    () => {
      const client = new Client();
      clients.push(client);
      return client;
    },
    (state) => states.push(state),
  );
  t.after(controller.dispose);
  return { clients, states, ...controller };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a disconnected desktop reconnects without replacing the guest session
 * 协作入口 / Collaborators: `fixture`, `clients[0].emit`, `assert.equal`, `states.at`.
 * 检查边界 / Checked boundaries: `assert.equal(states.at(-1)?.connected, true)`; `assert.match(states.at(-1)!.message, /1 秒后自动重连/)`.
 */
test('a disconnected desktop reconnects without replacing the guest session', (t) => {
  const { clients, states } = fixture(t);
  clients[0].emit('connect');
  assert.equal(states.at(-1)?.connected, true);
  clients[0].emit('disconnect');
  assert.match(states.at(-1)!.message, /1 秒后自动重连/);
  t.mock.timers.tick(999);
  assert.equal(clients.length, 1);
  t.mock.timers.tick(1);
  assert.equal(clients.length, 2);
  clients[1].emit('connect');
  const count = states.length;
  clients[0].emit('disconnect');
  assert.equal(states.length, count, 'stale clients cannot affect the new connection');
  assert.equal(states.at(-1)?.connected, true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a connection constructor failure uses the same bounded reconnect path
 * 协作入口 / Collaborators: `t.mock.timers.enable`, `connectDesktop`, `t.after`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(clients.length, 0)`; `assert.ok(states.some((state) => /socket unavailable/.test(state.error || '')))`.
 */
test('a connection constructor failure uses the same bounded reconnect path', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clients: Client[] = [];
  const states: { connected: boolean; message: string; error?: string }[] = [];
  let attempts = 0;
  const { dispose } = connectDesktop(
    () => {
      attempts++;
      if (attempts === 1) throw new Error('socket unavailable');
      const client = new Client();
      clients.push(client);
      return client;
    },
    (state) => states.push(state),
  );
  t.after(dispose);
  assert.equal(clients.length, 0);
  assert.ok(states.some((state) => /socket unavailable/.test(state.error || '')));
  t.mock.timers.tick(999);
  assert.equal(attempts, 1);
  t.mock.timers.tick(1);
  assert.equal(attempts, 2);
  clients[0].emit('connect');
  assert.equal(states.at(-1)?.connected, true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: silent RFB handshakes time out and retries stop after five attempts
 * 协作入口 / Collaborators: `fixture`, `t.mock.timers.tick`, `assert.equal`, `clients.at`.
 * 检查边界 / Checked boundaries: `assert.equal(clients.at(-1)?.disconnects, 1)`; `assert.equal(clients.length, 6)`.
 */
test('silent RFB handshakes time out and retries stop after five attempts', (t) => {
  const { clients, states } = fixture(t);
  for (const wait of [1000, 2000, 4000, 8000, 15000]) {
    t.mock.timers.tick(30000);
    assert.equal(clients.at(-1)?.disconnects, 1);
    t.mock.timers.tick(wait);
  }
  assert.equal(clients.length, 6);
  t.mock.timers.tick(30000);
  assert.match(states.at(-1)!.message, /自动重连未成功/);
  t.mock.timers.tick(60000);
  assert.equal(clients.length, 6);
});

for (const event of ['credentialsrequired', 'securityfailure']) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixture`, `clients[0].emit`, `assert.equal`, `assert.match`.
   * 检查边界 / Checked boundaries: `assert.equal(clients[0].disconnects, 1)`; `assert.match(states.at(-1)!.error!, /认证配置/)`.
   */
  test(`${event} stops retries and shows the authentication error`, (t) => {
    const { clients, states } = fixture(t);
    clients[0].emit(event);
    assert.equal(clients[0].disconnects, 1);
    assert.match(states.at(-1)!.error!, /认证配置/);
    t.mock.timers.tick(120000);
    assert.equal(clients.length, 1);
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: leaving the desktop cancels pending retries and releases active clients
 * 协作入口 / Collaborators: `fixture`, `pending.clients[0].emit`, `pending.dispose`, `t.mock.timers.tick`.
 * 检查边界 / Checked boundaries: `assert.equal(pending.clients.length, 1)`; `assert.equal(client.disconnects, 1)`.
 */
test('leaving the desktop cancels pending retries and releases active clients', (t) => {
  const pending = fixture(t);
  pending.clients[0].emit('disconnect');
  pending.dispose();
  t.mock.timers.tick(60000);
  assert.equal(pending.clients.length, 1);
  // Start another controller under the same clock, as when switching VMs.
  const client = new Client();
  let updates = 0;
  const { dispose } = connectDesktop(
    () => client,
    () => {
      updates++;
    },
  );
  dispose();
  assert.equal(client.disconnects, 1);
  client.emit('connect');
  t.mock.timers.tick(60000);
  assert.equal(updates, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: rapid disconnects retain backoff while a stable session resets it
 * 协作入口 / Collaborators: `fixture`, `clients[0].emit`, `t.mock.timers.tick`, `clients[1].emit`.
 * 检查边界 / Checked boundaries: `assert.match(states.at(-1)!.message, /2 秒后自动重连（2\/5）/)`; `assert.match(states.at(-1)!.message, /1 秒后自动重连（1\/5）/)`.
 */
test('rapid disconnects retain backoff while a stable session resets it', (t) => {
  const { clients, states } = fixture(t);
  clients[0].emit('connect');
  clients[0].emit('disconnect');
  t.mock.timers.tick(1000);
  clients[1].emit('connect');
  clients[1].emit('disconnect');
  assert.match(states.at(-1)!.message, /2 秒后自动重连（2\/5）/);
  t.mock.timers.tick(2000);
  clients[2].emit('connect');
  t.mock.timers.tick(30000);
  clients[2].emit('disconnect');
  assert.match(states.at(-1)!.message, /1 秒后自动重连（1\/5）/);
});

for (const order of ['SSH first', 'VNC first']) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixture`, `clients[0].emit`, `setAvailable`, `assert.match`.
   * 检查边界 / Checked boundaries: `assert.match(states.at(-1)!.message, /等待客户机连接恢复/)`; `assert.equal(clients.length, 1, 'an SSH outage must not consume retries or create more tunnels')`.
   */
  test(`simultaneous SSH and VNC loss waits for the guest and reconnects (${order})`, (t) => {
    const { clients, states, setAvailable } = fixture(t);
    clients[0].emit('connect');
    if (order === 'SSH first') setAvailable(false);
    clients[0].emit('disconnect');
    setAvailable(false);
    assert.match(states.at(-1)!.message, /等待客户机连接恢复/);
    t.mock.timers.tick(300000);
    assert.equal(clients.length, 1, 'an SSH outage must not consume retries or create more tunnels');
    // DesktopPanel receives `ready` again, without changing its cached desktop status.
    setAvailable(true);
    assert.equal(clients.length, 2);
    clients[1].emit('connect');
    assert.equal(states.at(-1)?.connected, true);
    setAvailable(true);
    assert.equal(clients.length, 2, 'ordinary status polls must not replace the session');
    clients[1].emit('disconnect');
    assert.match(states.at(-1)!.message, /1 秒后自动重连（1\/5）/);
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH recovery revives an exhausted retry loop even when the desktop remains ready
 * 协作入口 / Collaborators: `fixture`, `clients.at(-1)!.emit`, `clients.at`, `t.mock.timers.tick`.
 * 检查边界 / Checked boundaries: `assert.match(states.at(-1)!.message, /自动重连未成功/)`; `assert.equal(clients.length, 6, 'healthy polls cannot bypass the retry limit')`.
 */
test('SSH recovery revives an exhausted retry loop even when the desktop remains ready', (t) => {
  const { clients, states, setAvailable } = fixture(t);
  for (const wait of [1000, 2000, 4000, 8000, 15000]) {
    clients.at(-1)!.emit('disconnect');
    t.mock.timers.tick(wait);
  }
  clients.at(-1)!.emit('disconnect');
  assert.match(states.at(-1)!.message, /自动重连未成功/);
  setAvailable(true);
  t.mock.timers.tick(60000);
  assert.equal(clients.length, 6, 'healthy polls cannot bypass the retry limit');
  setAvailable(false);
  t.mock.timers.tick(300000);
  setAvailable(true);
  assert.equal(clients.length, 7);
  clients[6].emit('connect');
  assert.equal(states.at(-1)?.connected, true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH status failures preserve a working RFB client and an in-flight handshake
 * 协作入口 / Collaborators: `fixture`, `setAvailable`, `assert.equal`, `clients[0].emit`.
 * 检查边界 / Checked boundaries: `assert.equal(clients.length, 1, 'recovery during a handshake must not open a second client')`; `assert.equal(clients[0].disconnects, 0)`.
 */
test('SSH status failures preserve a working RFB client and an in-flight handshake', (t) => {
  const { clients, states, setAvailable } = fixture(t);
  setAvailable(false);
  setAvailable(true);
  assert.equal(clients.length, 1, 'recovery during a handshake must not open a second client');
  clients[0].emit('connect');
  setAvailable(false);
  t.mock.timers.tick(60000);
  assert.equal(clients[0].disconnects, 0);
  assert.equal(states.at(-1)?.connected, true);
  setAvailable(true);
  assert.equal(clients.length, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a handshake lost with SSH is released before waiting for recovery
 * 协作入口 / Collaborators: `fixture`, `setAvailable`, `t.mock.timers.tick`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(clients[0].disconnects, 1)`; `assert.match(states.at(-1)!.message, /等待客户机连接恢复/)`.
 */
test('a handshake lost with SSH is released before waiting for recovery', (t) => {
  const { clients, states, setAvailable } = fixture(t);
  setAvailable(false);
  t.mock.timers.tick(30000);
  assert.equal(clients[0].disconnects, 1);
  assert.match(states.at(-1)!.message, /等待客户机连接恢复/);
  setAvailable(true);
  assert.equal(clients.length, 2);
  clients[1].emit('connect');
  clients[0].emit('connect');
  clients[0].emit('securityfailure');
  assert.equal(states.at(-1)?.connected, true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: manual reconnect during an SSH outage waits, and disposal ignores late recovery
 * 协作入口 / Collaborators: `t.mock.timers.enable`, `connectDesktop`, `t.after`, `t.mock.timers.tick`.
 * 检查边界 / Checked boundaries: `assert.equal(clients.length, 0)`; `assert.equal(clients.length, 1)`.
 */
test('manual reconnect during an SSH outage waits, and disposal ignores late recovery', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clients: Client[] = [];
  const controller = connectDesktop(
    () => {
      const client = new Client();
      clients.push(client);
      return client;
    },
    () => {},
    false,
  );
  t.after(controller.dispose);
  t.mock.timers.tick(60000);
  assert.equal(clients.length, 0);
  controller.setAvailable(true);
  assert.equal(clients.length, 1);
  controller.setAvailable(false);
  clients[0].emit('disconnect');
  controller.dispose();
  controller.setAvailable(true);
  t.mock.timers.tick(60000);
  assert.equal(clients.length, 1);
});

for (const event of ['credentialsrequired', 'securityfailure']) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixture`, `setAvailable`, `clients[0].emit`, `t.mock.timers.tick`.
   * 检查边界 / Checked boundaries: `assert.equal(clients.length, 1)`; `assert.match(states.at(-1)!.error!, /认证配置/)`.
   */
  test(`SSH recovery cannot retry ${event}`, (t) => {
    const { clients, states, setAvailable } = fixture(t);
    setAvailable(false);
    clients[0].emit(event);
    setAvailable(true);
    t.mock.timers.tick(120000);
    assert.equal(clients.length, 1);
    assert.match(states.at(-1)!.error!, /认证配置/);
  });
}
