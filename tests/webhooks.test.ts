/**
 * 模块职责：回归验证模块，围绕 `webhooks` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `webhooks`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: metadata collection omits private fields and alert routes require all labels plus matching identities and types; actual HTTP receives a verifiable signature and stable id; durable retries deduplicate across restart and hide secrets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Webhooks, collectWebhookEvents, matchesWebhook } from '../server/webhooks.ts';
import type { WebhookEvent } from '../shared/webhooks.ts';
import type { Machines } from '../server/machines.ts';
import type { JobView } from '../server/jobs.ts';

const rule = {
  name: 'Receiver',
  url: 'http://127.0.0.1:12345/events',
  enabled: true,
  types: ['job.finished', 'alert.raised'],
  vmIds: [],
  projectIds: [],
  tags: [],
  statuses: [],
  kinds: [],
};
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: now: number; extra: Partial<WebhookEvent> = {}。
 * 结果：返回分支计算值（`({ id: createHash('sha256').update(randomUUID()).digest('hex'), type: 'job.finis…`）。
 * Result: Return the branch-computed value (`({ id: createHash('sha256').update(randomUUID()).digest('hex'), type: 'job.finis…`).
 * 协作入口 / Collaborators: `createHash('sha256').update(randomUUID()).digest`, `createHash('sha256').update`, `createHash`, `randomUUID`.
 */
const event = (now: number, extra: Partial<WebhookEvent> = {}): WebhookEvent => ({
  id: createHash('sha256').update(randomUUID()).digest('hex'),
  type: 'job.finished',
  occurredAt: new Date(now).toISOString(),
  tags: ['production'],
  status: 'error',
  ...extra,
});
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: test.TestContext; fetcher: typeof fetch。
 * 结果：返回受控对象，公开字段包括 `file, create, now, advance, events, block, mutations`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `file, create, now, advance, events, block, mutations`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))`.
 */
async function fixture(t: test.TestContext, fetcher?: typeof fetch) {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-webhooks-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  const file = join(directory, 'state.json'),
    managers: Webhooks[] = [];
  let now = Date.now(),
    events: WebhookEvent[] = [],
    blocked = false,
    mutations = 0;
  /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: schedule = false。
   * 结果：返回分支计算值（`manager`），以 Promise 交付。
   * Result: Return the branch-computed value (`manager`) through a Promise.
   * 协作入口 / Collaborators: `managers.push`, `manager.init`.
   */
  const create = async (schedule = false) => {
    const manager = new Webhooks(
      async () => events,
      file,
      fetcher,
      () => now,
      () => blocked,
      (delta) => {
        mutations += delta;
      },
    );
    managers.push(manager);
    await manager.init(schedule);
    return manager;
  };
  t.after(async () => {
    for (const manager of managers) await manager.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    file,
    create,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`now`）。
     * Result: Return the branch-computed value (`now`).
     */
    now: () => now,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: ms: number。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    advance: (ms: number) => {
      now += ms;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: WebhookEvent[]。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `events`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    events: (value: WebhookEvent[]) => {
      events = value;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `blocked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    block: (value: boolean) => {
      blocked = value;
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`mutations`）。
     * Result: Return the branch-computed value (`mutations`).
     */
    mutations: () => mutations,
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: metadata collection omits private fields and alert routes require all labels plus matching identities and types
 * 协作入口 / Collaborators: `randomUUID`, `new Date().toISOString`, `collectWebhookEvents`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(events.length, 2)`; `assert.ok(!JSON.stringify(events).includes('SECRET'))`.
 */
test('metadata collection omits private fields and alert routes require all labels plus matching identities and types', () => {
  const vmId = randomUUID(),
    jobId = randomUUID();
  const machines = {
    records: new Map([[vmId, { organization: { tags: ['production', 'api'] } }]]),
  } as unknown as Machines;
  const job: JobView = {
    id: jobId,
    key: 'sensitive key',
    vmId,
    projectId: 'project',
    scope: 'backups',
    title: 'SECRET_TITLE',
    log: 'SECRET_LOG',
    error: 'SECRET_ERROR',
    status: 'error',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
  const events = collectWebhookEvents(
    machines,
    [job, { ...job, status: 'running' }],
    [
      {
        id: randomUUID(),
        vmId,
        kind: 'secret',
        acknowledged: false,
        createdAt: new Date().toISOString(),
        message: 'SECRET_NAME_AND_VALUE',
      },
    ],
  );
  assert.equal(events.length, 2);
  assert.ok(!JSON.stringify(events).includes('SECRET'));
  const filter = {
    ...rule,
    types: ['alert.raised' as const],
    tags: ['production', 'api'],
    vmIds: [vmId],
    kinds: ['secret' as const],
    statuses: [],
  };
  assert.equal(matchesWebhook(filter, events[1]), true);
  assert.equal(matchesWebhook({ ...filter, tags: ['missing'] }, events[1]), false);
  assert.equal(matchesWebhook({ ...filter, vmIds: [randomUUID()] }, events[1]), false);
  assert.equal(matchesWebhook(filter, events[0]), false);
  assert.equal(matchesWebhook({ ...filter, projectIds: ['project'] }, events[1]), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: actual HTTP receives a verifiable signature and stable id; durable retries deduplicate across restart and hide secrets
 * 协作入口 / Collaborators: `createServer`, `t.after`, `fixture`, `f.create`.
 * 检查边界 / Checked boundaries: `assert.ok(configured.secret)`; `assert.equal(calls.length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('actual HTTP receives a verifiable signature and stable id; durable retries deduplicate across restart and hide secrets', async (t) => {
  const calls: { body: string; headers: any }[] = [];
  const receiver = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    calls.push({ body, headers: req.headers });
    res.writeHead(calls.length === 1 ? 503 : 204, { 'retry-after': '60' });
    res.end();
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => receiver.close(() => resolve())));
  const f = await fixture(t),
    manager = await f.create();
  const configured = await manager.configure({
    action: 'save',
    subscription: { ...rule, url: `http://127.0.0.1:${(receiver.address() as any).port}/events` },
  });
  assert.ok(configured.secret);
  f.events([event(f.now())]);
  await manager.tick();
  assert.equal(calls.length, 1);
  const pending = manager.view().deliveries[0];
  assert.equal(pending.status, 'pending');
  assert.equal(pending.attempts, 1);
  const expected = createHmac('sha256', Buffer.from(configured.secret!, 'hex'))
    .update(`${calls[0].headers['x-sakura-timestamp']}.${calls[0].body}`)
    .digest('hex');
  assert.equal(calls[0].headers['x-sakura-signature'], 'sha256=' + expected);
  assert.equal(calls[0].headers['idempotency-key'], pending.id);
  assert.ok(!JSON.stringify(manager.view()).includes(configured.secret!));
  f.advance(30000);
  await manager.tick();
  assert.equal(calls.length, 1);
  await manager.close();
  const restored = await f.create();
  f.advance(30000);
  await restored.tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers['x-sakura-delivery'], pending.id);
  assert.equal(restored.view().deliveries[0].status, 'delivered');
  assert.equal(restored.view().deliveries[0].attempts, 2);
  await restored.tick();
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).deliveries[0].status, 'delivered');
  assert.equal(f.mutations(), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: redirects and permanent rejection fail without automatic replay; explicit retries keep the identity and destination checks reject unsafe URLs
 * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.create`, `assert.rejects`, `manager.configure`.
 * 检查边界 / Checked boundaries: `assert.rejects(manager.configure({ action: 'save', subscription: { ...rule, url } }))`; `assert.equal(delivery.status, 'failed')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('redirects and permanent rejection fail without automatic replay; explicit retries keep the identity and destination checks reject unsafe URLs', async (t) => {
  let status = 302,
    calls = 0;
  const f = await fixture(t, async (_url, init) => {
    calls++;
    assert.equal(init?.redirect, 'manual');
    return new Response(null, { status, headers: { location: 'https://elsewhere.invalid/' } });
  });
  const manager = await f.create();
  for (const url of [
    'file:///x',
    'http://remote.example/events',
    'https://user:password@example.com/',
    'https://example.com/?secret=token',
    'https://example.com/#fragment',
  ])
    await assert.rejects(manager.configure({ action: 'save', subscription: { ...rule, url } }));
  const saved = await manager.configure({ action: 'save', subscription: rule });
  f.events([event(f.now())]);
  await manager.tick();
  let delivery = manager.view().deliveries[0];
  assert.equal(delivery.status, 'failed');
  assert.equal(calls, 1);
  await manager.tick();
  assert.equal(calls, 1);
  status = 204;
  await manager.configure({ action: 'retry', id: delivery.id });
  await manager.tick();
  assert.equal(manager.view().deliveries[0].status, 'delivered');
  assert.equal(calls, 2);
  await assert.rejects(
    manager.configure({ action: 'remove', id: saved.subscriptions[0].id, version: 99 }),
    /已改变/,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: disabled subscriptions collect nothing, explicit test works, rotation cancels backlog and changes the secret
 * 协作入口 / Collaborators: `fixture`, `f.create`, `manager.configure`, `f.events`.
 * 检查边界 / Checked boundaries: `assert.equal(calls, 0)`; `assert.equal(calls, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('disabled subscriptions collect nothing, explicit test works, rotation cancels backlog and changes the secret', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
      calls++;
      return new Response(null, { status: 500 });
    }),
    manager = await f.create();
  const saved = await manager.configure({ action: 'save', subscription: { ...rule, enabled: false } });
  f.events([event(f.now())]);
  await manager.tick();
  assert.equal(calls, 0);
  const subscription = saved.subscriptions[0];
  await manager.configure({ action: 'test', id: subscription.id, version: subscription.version });
  await manager.tick();
  assert.equal(calls, 1);
  assert.equal(manager.view().deliveries[0].event.type, 'test');
  const rotated = await manager.configure({
    action: 'rotate',
    id: subscription.id,
    version: subscription.version,
  });
  assert.notEqual(rotated.secret, saved.secret);
  assert.equal(rotated.deliveries[0].status, 'cancelled');
  f.advance(60000);
  await manager.tick();
  assert.equal(calls, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: removing a recipient aborts its in-flight attempt and never retargets the payload; migration and shutdown drain admitted work
 * 协作入口 / Collaborators: `fixture`, `f.create`, `manager.configure`, `f.events`.
 * 检查边界 / Checked boundaries: `assert.equal(manager.tick(), sending)`; `assert.rejects( manager.configure({ action: 'remove', id: saved.subscriptions[0].id, version: 1 }), /迁移/, )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('removing a recipient aborts its in-flight attempt and never retargets the payload; migration and shutdown drain admitted work', async (t) => {
  let begin!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const began = new Promise<void>((resolve) => {
    begin = resolve;
  });
  let aborted = false;
  const f = await fixture(t, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _url; init。
   * 结果：返回分支计算值（`new Promise((_resolve, reject) => init!.signal!.addEventListener( 'abort', () =>…`），以 Promise 交付。
   * Result: Return the branch-computed value (`new Promise((_resolve, reject) => init!.signal!.addEventListener( 'abort', () =>…`) through a Promise.
   * 验证场景 / Scenario: removing a recipient aborts its in-flight attempt and never retargets the payload; migration and shutdown drain admitted work
   * 协作入口 / Collaborators: `begin`.
   */
  async (_url, init) => {
    begin();
    return new Promise((_resolve, reject) =>
      init!.signal!.addEventListener(
        'abort',
        () => {
          aborted = true;
          reject(new Error('cancelled'));
        },
        { once: true },
      ),
    );
  });
  const manager = await f.create();
  const saved = await manager.configure({ action: 'save', subscription: rule });
  f.events([event(f.now())]);
  const sending = manager.tick();
  await began;
  assert.equal(manager.tick(), sending);
  f.block(true);
  await assert.rejects(
    manager.configure({ action: 'remove', id: saved.subscriptions[0].id, version: 1 }),
    /迁移/,
  );
  f.block(false);
  await manager.configure({ action: 'remove', id: saved.subscriptions[0].id, version: 1 });
  await sending;
  assert.equal(aborted, true);
  assert.equal(manager.view().deliveries[0].status, 'cancelled');
  assert.equal(f.mutations(), 0);
  await manager.close();
  await assert.rejects(manager.configure({ action: 'save', subscription: rule }), /关闭/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: queue pressure preserves admitted records and resumes collection, expired and historical events never backfill new subscriptions
 * 协作入口 / Collaborators: `fixture`, `f.create`, `manager.configure`, `Array.from`.
 * 检查边界 / Checked boundaries: `assert.rejects(manager.collect(), /队列/)`; `assert.equal(manager.view().deliveries.length, 500)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('queue pressure preserves admitted records and resumes collection, expired and historical events never backfill new subscriptions', async (t) => {
  const f = await fixture(t, async () => new Response(null, { status: 204 })),
    manager = await f.create();
  await manager.configure({ action: 'save', subscription: rule });
  const events = Array.from({ length: 501 }, () => event(f.now()));
  f.events([event(f.now() - 1), event(f.now() - 25 * 3600000), ...events]);
  await assert.rejects(manager.collect(), /队列/);
  assert.equal(manager.view().deliveries.length, 500);
  await manager.tick();
  assert.equal(manager.view().deliveries.filter((item) => item.status === 'delivered').length, 10);
  await manager.tick();
  assert.equal(manager.view().deliveries.length, 501);
  assert.equal(manager.view().deliveries.filter((item) => item.status === 'pending').length, 481);
  const persisted = JSON.parse(await readFile(f.file, 'utf8'));
  assert.ok(events.every((item) => Object.hasOwn(persisted.observed, item.id)));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: ambiguous in-flight delivery restarts with the same identity, retries stop at five, and corrupt stores fail closed
 * 状态影响 / State effects: `state.deliveries[0].status`, `state.deliveries[0].attempts`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.create`, `manager.configure`, `f.events`.
 * 检查边界 / Checked boundaries: `assert.equal(delivery.status, 'failed')`; `assert.equal(delivery.attempts, 5)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('ambiguous in-flight delivery restarts with the same identity, retries stop at five, and corrupt stores fail closed', async (t) => {
  const f = await fixture(t, async () => {
      throw new Error('network with PRIVATE_DETAILS');
    }),
    manager = await f.create();
  await manager.configure({ action: 'save', subscription: rule });
  f.events([event(f.now())]);
  await manager.collect();
  await manager.close();
  const state = JSON.parse(await readFile(f.file, 'utf8'));
  state.deliveries[0].status = 'sending';
  state.deliveries[0].attempts = 1;
  await writeFile(f.file, JSON.stringify(state));
  const restored = await f.create();
  for (let i = 0; i < 5; i++) {
    await restored.tick();
    f.advance(3600000);
  }
  const delivery = restored.view().deliveries[0];
  assert.equal(delivery.status, 'failed');
  assert.equal(delivery.attempts, 5);
  assert.equal(delivery.id, state.deliveries[0].id);
  assert.ok(!JSON.stringify(restored.view()).includes('PRIVATE_DETAILS'));
  await restored.close();
  await writeFile(f.file, '{corrupt');
  await assert.rejects(f.create());
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: shutdown aborts a pending network attempt and restart preserves its idempotency identity
 * 状态影响 / State effects: `respond`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.create`, `manager.configure`, `f.events`.
 * 检查边界 / Checked boundaries: `assert.equal(f.mutations(), 0)`; `assert.equal(JSON.parse(await readFile(f.file, 'utf8')).deliveries[0].status, 'sending')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('shutdown aborts a pending network attempt and restart preserves its idempotency identity', async (t) => {
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void,
    respond = false;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = await fixture(t, async (_url, init) => {
    if (respond) return new Response(null, { status: 204 });
    entered();
    return new Promise((_resolve, reject) =>
      init!.signal!.addEventListener('abort', () => reject(new Error('closed')), { once: true }),
    );
  });
  const manager = await f.create();
  await manager.configure({ action: 'save', subscription: rule });
  f.events([event(f.now())]);
  const running = manager.tick();
  await ready;
  const id = manager.view().deliveries[0].id;
  await manager.close();
  await running;
  assert.equal(f.mutations(), 0);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).deliveries[0].status, 'sending');
  respond = true;
  const restored = await f.create();
  await restored.tick();
  assert.equal(restored.view().deliveries[0].id, id);
  assert.equal(restored.view().deliveries[0].status, 'delivered');
});
