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
  const dispose = connectDesktop(
    () => {
      const client = new Client();
      clients.push(client);
      return client;
    },
    (state) => states.push(state),
  );
  t.after(dispose);
  return { clients, states, dispose };
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
  const dispose = connectDesktop(
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
