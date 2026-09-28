import assert from 'node:assert/strict';
import test from 'node:test';
import { ControllerSession, RefreshQueue } from '../src/controller-session.ts';
import { watchController } from '../src/controller-watch.ts';
import { connectTerminal } from '../src/terminal-connection.ts';

const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const deferred = () => {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve: () => resolve(),
  };
};

const sessionView = (locked: boolean) => ({
  configured: true,
  enabled: true,
  locked,
  idleMinutes: 1,
  retryAfterSeconds: 0,
});
test('a locked bootstrap displays the gate and never admits a pending mutation or replays it on unlock', async () => {
  let locked = true,
    mutations = 0,
    bootstraps = 0;
  const session = new ControllerSession(async (url) => {
    if (url === '/api/bootstrap') {
      bootstraps++;
      return locked
        ? Response.json({ error: 'locked', session: sessionView(true) }, { status: 423 })
        : Response.json({ token: 'new', session: sessionView(false) });
    }
    mutations++;
    return Response.json({ ok: true });
  });
  await assert.rejects(session.request('/vms', 'POST', {}), /locked/);
  assert.equal(session.getSession().locked, true);
  assert.equal(session.getToken(), '');
  locked = false;
  session.updateSession(sessionView(false));
  assert.equal(mutations, 0);
  await session.request('/vms', 'POST', {});
  assert.equal(mutations, 1);
  assert.equal(bootstraps, 2);
});

test('a private 423 clears credentials and stale bootstrap completion cannot restore a locked session', async () => {
  const gate = deferred();
  let auth = 0;
  const session = new ControllerSession(async (url) => {
    if (url === '/api/bootstrap') {
      auth++;
      if (auth === 2) await gate.promise;
      return Response.json({ token: String(auth) });
    }
    return Response.json({ error: 'locked', session: sessionView(true) }, { status: 423 });
  });
  await session.authenticate();
  const stale = session.authenticate();
  await assert.rejects(session.request('/vms'), /locked/);
  gate.resolve();
  await assert.rejects(stale, /会话状态/);
  assert.equal(session.getToken(), '');
  assert.equal(session.getSession().locked, true);
});

test('private data received after locking is discarded even when the old request succeeded', async () => {
  const gate = deferred();
  const session = new ControllerSession(async (url) => {
    if (url === '/api/bootstrap') return Response.json({ token: 'before' });
    await gate.promise;
    return Response.json({ secret: 'must not return to the private view' });
  });
  await session.authenticate();
  const pending = session.request('/vms');
  session.updateSession(sessionView(true));
  gate.resolve();
  await assert.rejects(pending, /会话状态/);
  assert.equal(session.getToken(), '');
});

test('concurrent expired requests obtain one new credential and retry only the rejected operation', async () => {
  let bootstraps = 0,
    writes = 0;
  const session = new ControllerSession(async (url, init) => {
    if (url === '/api/bootstrap') return Response.json({ token: 'token-' + ++bootstraps });
    if ((init?.headers as Record<string, string>)['X-Sakura-Token'] !== 'token-2')
      return Response.json({ error: 'expired' }, { status: 401 });
    if (init?.method === 'POST') writes++;
    return Response.json({ ok: true });
  });
  const credentials: string[] = [];
  const unsubscribe = session.subscribe(() => credentials.push(session.getToken()));
  await session.authenticate();
  await Promise.all([session.request('/vms'), session.request('/vms/id/start', 'POST')]);
  assert.equal(bootstraps, 2);
  assert.equal(writes, 1);
  assert.deepEqual(credentials, ['token-1', 'token-2']);
  unsubscribe();
});

test('account credentials never fall back to public bootstrap or replay a rejected mutation', async () => {
  let bootstrap = 0, writes = 0;
  const session = new ControllerSession(async (url) => {
    if (url === '/api/bootstrap') { bootstrap++; return Response.json({ token: 'legacy-admin' }); }
    writes++;
    return Response.json({ error: 'expired' }, { status: 401 });
  });
  session.setAccountMode(true);
  session.adoptAccount('a'.repeat(64), { id: 'owner', username: 'owner', role: 'owner',
    vmIds: [], expiresAt: Date.now() + 10000 });
  assert.equal(await session.authenticate(), 'a'.repeat(64));
  assert.equal(bootstrap, 0);
  await assert.rejects(session.request('/vms', 'POST', {}), /重新登录/);
  assert.equal(writes, 1);
  assert.equal(bootstrap, 0);
  assert.equal(session.getToken(), '');
  await assert.rejects(session.request('/vms'), /重新登录/);
  assert.equal(writes, 1);
});

test('a lost mutation response is never replayed and cancelled requests do not execute after authentication', async () => {
  const gate = deferred();
  let mutations = 0;
  const session = new ControllerSession(async (url) => {
    if (url === '/api/bootstrap') {
      await gate.promise;
      return Response.json({ token: 'ready' });
    }
    mutations++;
    throw new TypeError('connection lost after the server accepted the command');
  });
  const abort = new AbortController();
  const cancelled = session.request('/vms', 'POST', {}, abort.signal);
  abort.abort();
  gate.resolve();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(mutations, 0);
  await assert.rejects(session.request('/vms', 'POST'), /connection lost/);
  assert.equal(mutations, 1);
});

test('a refresh burst has at most one active read and includes changes received during that read', async () => {
  const queue = new RefreshQueue(),
    gate = deferred();
  let reads = 0;
  const read = async () => {
    reads++;
    if (reads === 1) await gate.promise;
  };
  const first = queue.run(read);
  await settle();
  for (let i = 0; i < 20; i++) assert.equal(queue.run(read), first);
  assert.equal(reads, 1);
  gate.resolve();
  await first;
  assert.equal(reads, 2);
  await assert.rejects(
    queue.run(async () => {
      throw new Error('offline');
    }),
    /offline/,
  );
  await queue.run(read);
  assert.equal(reads, 3);
});

class FakeSocket {
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: string[] = [];
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  send(value: string) {
    this.sent.push(value);
  }
  message(type: string, data?: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type, data }) });
  }
}

test('controller events coalesce, hidden windows stop polling, and reconnect authenticates again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = new EventTarget();
  const sockets: FakeSocket[] = [];
  let reads = 0,
    credentials = 0;
  const watch = watchController({
    session: { authenticate: async () => String(++credentials) },
    refresh: async () => {
      reads++;
    },
    error: () => {},
    settled: () => {},
    document: document as unknown as Document,
    window: window as unknown as Window,
    socket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  await settle();
  assert.equal(reads, 1);
  for (let i = 0; i < 10; i++) sockets[0].message('change');
  t.mock.timers.tick(75);
  await settle();
  assert.equal(reads, 2);
  t.mock.timers.tick(3500);
  await settle();
  assert.equal(reads, 2, 'the old 3.5s full refresh is gone');
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(reads, 2);
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(credentials, 2);
  assert.equal(reads, 3);
  sockets[1].close();
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(credentials, 3);
  watch.close();
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(credentials, 3);
});

test('terminal reattaches using a fresh credential without replaying input or reconnecting an exited shell', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets: FakeSocket[] = [],
    credentials: string[] = [],
    output: string[] = [];
  let auth = 0;
  const terminal = connectTerminal({
    authenticate: async () => 'token-' + ++auth,
    socket: (token) => {
      credentials.push(token);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    data: (text) => output.push(text),
    report: () => {},
    ready: () => {},
    logs: false,
  });
  await settle();
  sockets[0].message('ready');
  sockets[0].message('data', 'before outage');
  terminal.send({ type: 'input', data: 'once\n' });
  sockets[0].close();
  terminal.send({ type: 'input', data: 'while offline\n' });
  t.mock.timers.tick(1000);
  await settle();
  sockets[1].message('ready');
  sockets[1].message('data', 'after outage');
  assert.deepEqual(credentials, ['token-1', 'token-2']);
  assert.equal(sockets[0].sent.length, 1);
  assert.equal(sockets[1].sent.length, 0);
  assert.deepEqual(output, ['before outage', 'after outage']);
  sockets[1].message('exit');
  sockets[1].close();
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(auth, 2);
  terminal.close();
});
