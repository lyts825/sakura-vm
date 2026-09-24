import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { connectDesktop } from '../src/desktop-connection.ts';

class Client extends EventTarget {
  disconnects = 0;
  disconnect() {
    this.disconnects++;
    this.emit('disconnect');
  }
  emit(event: string) {
    this.dispatchEvent(new Event(event));
  }
}

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
  test(`${event} stops retries and shows the authentication error`, (t) => {
    const { clients, states } = fixture(t);
    clients[0].emit(event);
    assert.equal(clients[0].disconnects, 1);
    assert.match(states.at(-1)!.error!, /认证配置/);
    t.mock.timers.tick(120000);
    assert.equal(clients.length, 1);
  });
}

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
