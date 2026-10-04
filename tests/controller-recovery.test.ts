import assert from 'node:assert/strict';
import test from 'node:test';
import { ControllerSession, RefreshQueue } from '../src/controller-session.ts';
import { watchController } from '../src/controller-watch.ts';
import { connectTerminal } from '../src/terminal-connection.ts';
import { GraphApi } from '../server/graphql-api.ts';

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
test('GraphQL query validation remains visible through the controller without exposing unclassified HTTP errors', async t => {
  const graph = new GraphApi(async () => { throw new Error('EXCLUDED_INTERNAL_SOURCE'); });
  t.after(() => graph.close());
  const session = new ControllerSession(async (url, init) => {
    if (url === '/api/bootstrap') return Response.json({ token: 'ready' });
    const result = await graph.query(JSON.parse(String(init?.body)));
    return Response.json(result.body, { status: result.status,
      headers: { 'content-type': 'application/graphql-response+json', 'x-sakura-correlation-id': 'query-correlation' } });
  });
  for (const [query, code, message] of [
    ['{ unknownField }', 'GRAPHQL_VALIDATION_FAILED', /unknownField/],
    ['{', 'GRAPHQL_PARSE_FAILED', /Syntax Error/],
    ['query Read($n:Int!){ vms(limit:$n){ id } }', 'BAD_USER_INPUT', /\$n/],
  ] as const) await assert.rejects(session.request('/graphql', 'POST', { query }), (error: any) => {
    assert.equal(error.status, 400); assert.equal(error.code, code);
    assert.equal(error.correlationId, 'query-correlation'); assert.match(error.message, message);
    assert.doesNotMatch(error.message, /EXCLUDED_/); return true;
  });
  const secret = 'EXCLUDED_INTERNAL_EXCEPTION';
  for (const fixture of [
    { path: '/graphql', status: 400, media: 'application/graphql-response+json', code: undefined },
    { path: '/graphql', status: 400, media: 'application/graphql-response+json', code: 'SOURCE_UNAVAILABLE' },
    { path: '/graphql', status: 500, media: 'application/graphql-response+json', code: 'GRAPHQL_VALIDATION_FAILED' },
    { path: '/graphql', status: 400, media: 'application/json', code: 'GRAPHQL_VALIDATION_FAILED' },
    { path: '/vms', status: 400, media: 'application/graphql-response+json', code: 'GRAPHQL_VALIDATION_FAILED' },
    { path: '/graphql', status: 400, media: 'application/graphql-response+json', code: 'GRAPHQL_VALIDATION_FAILED', count: 11 },
  ]) {
    const rejected = new ControllerSession(async url => url === '/api/bootstrap' ? Response.json({ token: 'ready' }) :
      Response.json({ errors: Array.from({ length: fixture.count || 1 }, () => ({ message: secret, extensions: { code: fixture.code } })) },
        { status: fixture.status, headers: { 'content-type': fixture.media } }));
    await assert.rejects(rejected.request(fixture.path, 'POST', {}), (error: any) => {
      assert.equal(error.status, fixture.status); assert.equal(error.code, 'HTTP_ERROR');
      assert.doesNotMatch(error.message, /EXCLUDED_/); return true;
    });
  }
  const longMessage = new ControllerSession(async url => url === '/api/bootstrap' ? Response.json({ token: 'ready' }) :
    Response.json({ errors: [{ message: 'x'.repeat(3000), extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] },
      { status: 400, headers: { 'content-type': 'application/graphql-response+json' } }));
  await assert.rejects(longMessage.request('/graphql', 'POST', {}), (error: any) => {
    assert.equal(error.message.length, 2000); return true;
  });
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

test('expired replies retain their HTTP status and never automatically replay a mutation', async () => {
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
  const rejected = await Promise.allSettled([session.request('/vms'), session.request('/vms/id/start', 'POST')]);
  assert.ok(rejected.every(result => result.status === 'rejected' && result.reason.status === 401));
  assert.equal(bootstraps, 1);
  assert.equal(writes, 0);
  await session.request('/vms/id/start', 'POST');
  assert.equal(bootstraps, 2);
  assert.equal(writes, 1);
  assert.equal(credentials.at(-1), 'token-2');
  unsubscribe();
});

const rejectedBeforeExecution = () => ({ error: '凭证已过期', code: 'UNAUTHORIZED',
  correlationId: '11111111-1111-4111-8111-111111111111', operationResult: {
    correlationId: '11111111-1111-4111-8111-111111111111', outcome: 'failed', executed: false,
  } });

test('retained artifact reads refresh a rejected controller credential once after restart', async () => {
  for (const path of ['/sandboxes/artifact?run=run&artifact=artifact', '/vms/vm/rescue/artifact?run=run&artifact=artifact',
    '/vms/vm/backup-recovery/artifact?run=run&artifact=artifact']) {
    let token = 'before', bootstraps = 0, executed = 0;
    const credentials: string[] = [];
    const session = new ControllerSession(async (url, init) => {
      if (url === '/api/bootstrap') { bootstraps++; return Response.json({ token }); }
      assert.equal(url, '/api' + path);
      const credential = new Headers(init?.headers).get('x-sakura-token')!;
      credentials.push(credential);
      if (credential !== token) return Response.json(rejectedBeforeExecution(), { status: 401 });
      executed++; return Response.json({ name: 'report.txt', base64: 'cmV0YWluZWQ=' });
    });
    await session.authenticate(); token = 'after';
    assert.deepEqual(await session.request(path), { name: 'report.txt', base64: 'cmV0YWluZWQ=' });
    assert.deepEqual(credentials, ['before', 'after']); assert.equal(executed, 1); assert.equal(bootstraps, 2);
  }
});

test('parallel rejected reads share refresh and late old replies cannot clear the fresh credential', async () => {
  const refresh = deferred(), lateRead = deferred(), lateWrite = deferred();
  let bootstraps = 0, oldReads = 0, newReads = 0, writes = 0;
  const session = new ControllerSession(async (url, init) => {
    if (url === '/api/bootstrap') {
      if (++bootstraps === 2) await refresh.promise;
      return Response.json({ token: bootstraps === 1 ? 'before' : 'after' });
    }
    if (init?.method === 'POST') { writes++; await lateWrite.promise; return Response.json(rejectedBeforeExecution(), { status: 401 }); }
    if (new Headers(init?.headers).get('x-sakura-token') === 'before') {
      if (++oldReads === 2) await lateRead.promise;
      return Response.json(rejectedBeforeExecution(), { status: 401 });
    }
    newReads++; return Response.json({ ok: true });
  });
  await session.authenticate();
  const write = assert.rejects(session.request('/vms/vm/start', 'POST'), { status: 401 });
  const first = session.request('/sandboxes/artifact?run=run&artifact=artifact');
  const second = session.request('/vms/vm/rescue/artifact?run=run&artifact=artifact');
  await settle(); assert.equal(bootstraps, 2);
  refresh.resolve(); await first;
  assert.equal(session.getToken(), 'after');
  lateRead.resolve(); await second;
  lateWrite.resolve(); await write;
  assert.equal(session.getToken(), 'after'); assert.equal(bootstraps, 2);
  assert.equal(oldReads, 2); assert.equal(newReads, 2); assert.equal(writes, 1);
});

test('read refresh requires an explicit non-execution receipt and stops after one retry', async () => {
  const confirmed = rejectedBeforeExecution();
  for (const result of [{ error: 'expired' }, { ...confirmed, operationResult: undefined },
    { ...confirmed, operationResult: { ...confirmed.operationResult, executed: true } },
    { ...confirmed, operationResult: { ...confirmed.operationResult, outcome: 'unknown' } },
    { ...confirmed, operationResult: { ...confirmed.operationResult, correlationId: 'different' } }]) {
    let bootstraps = 0, reads = 0;
    const session = new ControllerSession(async url => {
      if (url === '/api/bootstrap') { bootstraps++; return Response.json({ token: 'before' }); }
      reads++; return Response.json(result, { status: 401 });
    });
    await assert.rejects(session.request('/sandboxes/artifact'), { status: 401 });
    assert.equal(reads, 1); assert.equal(bootstraps, 1);
  }
  let bootstraps = 0, reads = 0;
  const session = new ControllerSession(async url => {
    if (url === '/api/bootstrap') return Response.json({ token: 'token-' + ++bootstraps });
    reads++; return Response.json(confirmed, { status: 401 });
  });
  await assert.rejects(session.request('/sandboxes/artifact'), { status: 401 });
  assert.equal(reads, 2); assert.equal(bootstraps, 2); assert.equal(session.getToken(), '');
});

test('confirmed 401 reads cannot fall back from account mode or bypass cancellation and locking', async () => {
  let bootstraps = 0, requests = 0;
  const account = new ControllerSession(async url => {
    if (url === '/api/bootstrap') bootstraps++;
    requests++; return Response.json(rejectedBeforeExecution(), { status: 401 });
  });
  account.adoptAccount('a'.repeat(64), { id: 'owner', username: 'owner', role: 'owner', vmIds: [], expiresAt: Date.now() + 10000 });
  await assert.rejects(account.request('/sandboxes/artifact'), { status: 401 });
  assert.equal(bootstraps, 0); assert.equal(requests, 1);
  const gate = deferred(); bootstraps = 0; requests = 0;
  const cancelled = new ControllerSession(async url => {
    if (url === '/api/bootstrap') {
      if (++bootstraps === 2) await gate.promise;
      return Response.json({ token: 'token-' + bootstraps });
    }
    requests++; return Response.json(rejectedBeforeExecution(), { status: 401 });
  });
  await cancelled.authenticate();
  const abort = new AbortController(), pending = cancelled.request('/sandboxes/artifact', 'GET', undefined, abort.signal);
  await settle(); abort.abort();
  await assert.rejects(pending, { name: 'AbortError' }); gate.resolve(); await settle();
  assert.equal(requests, 1);
  let lockedReads = 0, lockedBootstraps = 0;
  const locked = new ControllerSession(async url => {
    if (url === '/api/bootstrap') return ++lockedBootstraps === 1 ? Response.json({ token: 'before' }) :
      Response.json({ error: 'locked', session: sessionView(true) }, { status: 423 });
    lockedReads++; return Response.json(rejectedBeforeExecution(), { status: 401 });
  });
  await assert.rejects(locked.request('/sandboxes/artifact'), { status: 423 });
  assert.equal(lockedReads, 1); assert.equal(locked.getSession().locked, true);
  const changed = deferred(); let changedBootstraps = 0;
  const changedSession = new ControllerSession(async url => {
    if (url === '/api/bootstrap') { changedBootstraps++; return Response.json({ token: 'a'.repeat(64) }); }
    await changed.promise; return Response.json(rejectedBeforeExecution(), { status: 401 });
  });
  await changedSession.authenticate();
  const oldRequest = assert.rejects(changedSession.request('/sandboxes/artifact'), { status: 401 });
  await settle();
  changedSession.adoptAccount('a'.repeat(64), { id: 'owner', username: 'owner', role: 'owner', vmIds: [], expiresAt: Date.now() + 10000 });
  changed.resolve(); await oldRequest;
  assert.equal(changedSession.getToken(), 'a'.repeat(64)); assert.equal(changedBootstraps, 1);
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
  await assert.rejects(session.request('/vms', 'POST', {}), { status: 401 });
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
