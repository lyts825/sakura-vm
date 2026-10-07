/**
 * 模块职责：回归验证模块，围绕 `controller-recovery` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `controller-recovery`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: GraphQL query validation remains visible through the controller without exposing unclassified HTTP errors; a locked bootstrap displays the gate and never admits a pending mutation or replays it on unlock.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ControllerSession, RefreshQueue } from '../src/controller-session.ts';
import { watchController } from '../src/controller-watch.ts';
import { connectTerminal } from '../src/terminal-connection.ts';
import { GraphApi } from '../server/graphql-api.ts';

/**
 * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
 * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `Promise.resolve`.
 */
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, resolve`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, resolve`; the actual branch determines its shape.
 */
const deferred = () => {
  let resolve!: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    /**
     * 中文功能：完成夹具中预先保存的 Promise，使等待它的异步步骤取得传入值。
     * English: Settle the Promise retained by the fixture so waiting asynchronous steps receive the supplied value.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`resolve()`）。
     * Result: Return the branch-computed value (`resolve()`).
     * 协作入口 / Collaborators: `resolve`.
     */
    resolve: () => resolve(),
  };
};

/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: locked: boolean。
 * 结果：返回分支计算值（`({ configured: true, enabled: true, locked, idleMinutes: 1, retryAfterSeconds: 0…`）。
 * Result: Return the branch-computed value (`({ configured: true, enabled: true, locked, idleMinutes: 1, retryAfterSeconds: 0…`).
 */
const sessionView = (locked: boolean) => ({
  configured: true,
  enabled: true,
  locked,
  idleMinutes: 1,
  retryAfterSeconds: 0,
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GraphQL query validation remains visible through the controller without exposing unclassified HTTP errors
 * 协作入口 / Collaborators: `t.after`, `assert.rejects`, `session.request`, `rejected.request`.
 * 检查边界 / Checked boundaries: `assert.rejects(session.request('/graphql', 'POST', { query }), (error: any) => { assert.equal(error.status, 400); assert.equal(err…`; `assert.rejects(rejected.request(fixture.path, 'POST', {}), (error: any) => { assert.equal(error.status, fixture.status); assert.eq…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a locked bootstrap displays the gate and never admits a pending mutation or replays it on unlock
 * 状态影响 / State effects: `locked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `assert.rejects`, `session.request`, `assert.equal`, `session.getSession`.
 * 检查边界 / Checked boundaries: `assert.rejects(session.request('/vms', 'POST', {}), /locked/)`; `assert.equal(session.getSession().locked, true)`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a private 423 clears credentials and stale bootstrap completion cannot restore a locked session
 * 协作入口 / Collaborators: `deferred`, `session.authenticate`, `assert.rejects`, `session.request`.
 * 检查边界 / Checked boundaries: `assert.rejects(session.request('/vms'), /locked/)`; `assert.rejects(stale, /会话状态/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private data received after locking is discarded even when the old request succeeded
 * 协作入口 / Collaborators: `deferred`, `session.authenticate`, `session.request`, `session.updateSession`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, /会话状态/)`; `assert.equal(session.getToken(), '')`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: expired replies retain their HTTP status and never automatically replay a mutation
 * 协作入口 / Collaborators: `session.subscribe`, `session.authenticate`, `Promise.allSettled`, `session.request`.
 * 检查边界 / Checked boundaries: `assert.ok(rejected.every(result => result.status === 'rejected' && result.reason.status === 401))`; `assert.equal(bootstraps, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`({ error: '凭证已过期', code: 'UNAUTHORIZED', correlationId: '11111111-1111-4111-8111…`）。
 * Result: Return the branch-computed value (`({ error: '凭证已过期', code: 'UNAUTHORIZED', correlationId: '11111111-1111-4111-8111…`).
 */
const rejectedBeforeExecution = () => ({ error: '凭证已过期', code: 'UNAUTHORIZED',
  correlationId: '11111111-1111-4111-8111-111111111111', operationResult: {
    correlationId: '11111111-1111-4111-8111-111111111111', outcome: 'failed', executed: false,
  } });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: retained artifact reads refresh a rejected controller credential once after restart
 * 状态影响 / State effects: `token`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `session.authenticate`, `assert.deepEqual`, `session.request`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await session.request(path), { name: 'report.txt', base64: 'cmV0YWluZWQ=' })`; `assert.deepEqual(credentials, ['before', 'after'])`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: parallel rejected reads share refresh and late old replies cannot clear the fresh credential
 * 协作入口 / Collaborators: `deferred`, `session.authenticate`, `assert.rejects`, `session.request`.
 * 检查边界 / Checked boundaries: `assert.rejects(session.request('/vms/vm/start', 'POST'), { status: 401 })`; `assert.equal(bootstraps, 2)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: read refresh requires an explicit non-execution receipt and stops after one retry
 * 协作入口 / Collaborators: `rejectedBeforeExecution`, `assert.rejects`, `session.request`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(session.request('/sandboxes/artifact'), { status: 401 })`; `assert.equal(reads, 1)`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: confirmed 401 reads cannot fall back from account mode or bypass cancellation and locking
 * 状态影响 / State effects: `bootstraps`, `requests`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `account.adoptAccount`, `'a'.repeat`, `Date.now`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(account.request('/sandboxes/artifact'), { status: 401 })`; `assert.equal(bootstraps, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: account credentials never fall back to public bootstrap or replay a rejected mutation
 * 协作入口 / Collaborators: `session.setAccountMode`, `session.adoptAccount`, `'a'.repeat`, `Date.now`.
 * 检查边界 / Checked boundaries: `assert.equal(await session.authenticate(), 'a'.repeat(64))`; `assert.equal(bootstrap, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a lost mutation response is never replayed and cancelled requests do not execute after authentication
 * 协作入口 / Collaborators: `deferred`, `session.request`, `abort.abort`, `gate.resolve`.
 * 检查边界 / Checked boundaries: `assert.rejects(cancelled, { name: 'AbortError' })`; `assert.equal(mutations, 0)`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a refresh burst has at most one active read and includes changes received during that read
 * 协作入口 / Collaborators: `deferred`, `queue.run`, `settle`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(queue.run(read), first)`; `assert.equal(reads, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a refresh burst has at most one active read and includes changes received during that read', async () => {
  const queue = new RefreshQueue(),
    gate = deferred();
  let reads = 0;
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: a refresh burst has at most one active read and includes changes received during that read
   */
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
  onopen: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void) | null = null;
  onclose: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void) | null = null;
  onerror: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void) | null = null;
  onmessage: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: event: { data: string }。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (event: { data: string }) => void) | null = null;
  sent: string[] = [];
  /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `this.readyState`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `this.onclose`.
   */
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: value: string。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `this.sent.push`.
   */
  send(value: string) {
    this.sent.push(value);
  }
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: type: string; data: unknown。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `this.onmessage`, `JSON.stringify`.
   */
  message(type: string, data?: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type, data }) });
  }
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: controller events coalesce, hidden windows stop polling, and reconnect authenticates again
 * 状态影响 / State effects: `document.visibilityState`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `t.mock.timers.enable`, `Object.assign`, `watchController`, `settle`.
 * 检查边界 / Checked boundaries: `assert.equal(reads, 1)`; `assert.equal(reads, 2)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('controller events coalesce, hidden windows stop polling, and reconnect authenticates again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = new EventTarget();
  const sockets: FakeSocket[] = [];
  let reads = 0,
    credentials = 0;
  const watch = watchController({
    session: { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`String(++credentials)`），以 Promise 交付。
     * Result: Return the branch-computed value (`String(++credentials)`) through a Promise.
     * 验证场景 / Scenario: controller events coalesce, hidden windows stop polling, and reconnect authenticates again
     * 协作入口 / Collaborators: `String`.
     */
    authenticate: async () => String(++credentials) },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: controller events coalesce, hidden windows stop polling, and reconnect authenticates again
     */
    refresh: async () => {
      reads++;
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: controller events coalesce, hidden windows stop polling, and reconnect authenticates again
     */
    error: () => {},
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: controller events coalesce, hidden windows stop polling, and reconnect authenticates again
     */
    settled: () => {},
    document: document as unknown as Document,
    window: window as unknown as Window,
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`socket as unknown as WebSocket`）。
     * Result: Return the branch-computed value (`socket as unknown as WebSocket`).
     * 验证场景 / Scenario: controller events coalesce, hidden windows stop polling, and reconnect authenticates again
     * 协作入口 / Collaborators: `sockets.push`.
     */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: terminal reattaches using a fresh credential without replaying input or reconnecting an exited shell
 * 协作入口 / Collaborators: `t.mock.timers.enable`, `connectTerminal`, `settle`, `sockets[0].message`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(credentials, ['token-1', 'token-2'])`; `assert.equal(sockets[0].sent.length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('terminal reattaches using a fresh credential without replaying input or reconnecting an exited shell', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets: FakeSocket[] = [],
    credentials: string[] = [],
    output: string[] = [];
  let auth = 0;
  const terminal = connectTerminal({
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'token-' + ++auth`），以 Promise 交付。
     * Result: Return the branch-computed value (`'token-' + ++auth`) through a Promise.
     * 验证场景 / Scenario: terminal reattaches using a fresh credential without replaying input or reconnecting an exited shell
     */
    authenticate: async () => 'token-' + ++auth,
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: token。
     * 结果：返回分支计算值（`socket as unknown as WebSocket`）。
     * Result: Return the branch-computed value (`socket as unknown as WebSocket`).
     * 验证场景 / Scenario: terminal reattaches using a fresh credential without replaying input or reconnecting an exited shell
     * 协作入口 / Collaborators: `credentials.push`, `sockets.push`.
     */
    socket: (token) => {
      credentials.push(token);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: text。
     * 结果：返回分支计算值（`output.push(text)`）。
     * Result: Return the branch-computed value (`output.push(text)`).
     * 验证场景 / Scenario: terminal reattaches using a fresh credential without replaying input or reconnecting an exited shell
     * 协作入口 / Collaborators: `output.push`.
     */
    data: (text) => output.push(text),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: terminal reattaches using a fresh credential without replaying input or reconnecting an exited shell
     */
    report: () => {},
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: terminal reattaches using a fresh credential without replaying input or reconnecting an exited shell
     */
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
