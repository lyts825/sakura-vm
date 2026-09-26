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
const event = (now: number, extra: Partial<WebhookEvent> = {}): WebhookEvent => ({
  id: createHash('sha256').update(randomUUID()).digest('hex'),
  type: 'job.finished',
  occurredAt: new Date(now).toISOString(),
  tags: ['production'],
  status: 'error',
  ...extra,
});
async function fixture(t: test.TestContext, fetcher?: typeof fetch) {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-webhooks-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  const file = join(directory, 'state.json'),
    managers: Webhooks[] = [];
  let now = Date.now(),
    events: WebhookEvent[] = [],
    blocked = false,
    mutations = 0;
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
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    events: (value: WebhookEvent[]) => {
      events = value;
    },
    block: (value: boolean) => {
      blocked = value;
    },
    mutations: () => mutations,
  };
}

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

test('removing a recipient aborts its in-flight attempt and never retargets the payload; migration and shutdown drain admitted work', async (t) => {
  let begin!: () => void;
  const began = new Promise<void>((resolve) => {
    begin = resolve;
  });
  let aborted = false;
  const f = await fixture(t, async (_url, init) => {
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

test('shutdown aborts a pending network attempt and restart preserves its idempotency identity', async (t) => {
  let entered!: () => void,
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
