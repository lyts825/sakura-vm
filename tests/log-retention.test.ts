import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { Jobs, type JobView } from '../server/jobs.ts';
import { LogRetention, logRetentionPolicy, planLogRetention } from '../server/log-retention.ts';

const now = Date.now(),
  day = 86400000;
const policy = { enabled: true, days: 7, maxMiB: 1 };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function job(age: number, log = 'sensitive old output'): JobView {
  return {
    id: randomUUID(),
    key: randomUUID(),
    status: 'done',
    startedAt: new Date(now - age * day - 1000).toISOString(),
    finishedAt: new Date(now - age * day).toISOString(),
    log,
    title: 'Retained task identity',
  };
}
async function setup(t: test.TestContext, rows: JobView[], name = 'history') {
  const folder = await mkdtemp(join(tmpdir(), 'sakura-log-retention-'));
  await writeFile(join(folder, name + '.json'), JSON.stringify(rows));
  const store = new Jobs(name, folder);
  t.after(async () => {
    await store.close();
    await rm(folder, { recursive: true, force: true });
  });
  return { folder, store, file: join(folder, 'policy.json') };
}

test('log retention enforces age and global UTF-8 bytes while protecting active and invalid-time evidence', async (t) => {
  const old = job(10),
    oldest = job(3, '中'.repeat(200000)),
    newest = job(1, 'x'.repeat(600000)),
    future = job(-1);
  const first = await setup(t, [old, oldest]),
    second = await setup(t, [newest, future]);
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const active = first.store.start('active', async (log) => {
    log('active secret output');
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  t.after(() => release());
  await ready;
  const plan = planLogRetention([first.store, second.store], policy, now);
  assert.equal(plan.summary.completedBytes, Buffer.byteLength(old.log) + 1200000);
  assert.deepEqual(
    plan.removals.map((item) => item.job.id),
    [old.id, oldest.id],
  );
  assert.equal(plan.summary.expiredLogs, 1);
  assert.equal(plan.summary.capacityLogs, 1);
  assert.equal(plan.summary.protectedLogs, 2);
  assert.equal(plan.summary.remainingBytes, 600000);
  const manager = new LogRetention(
    () => [first.store, second.store],
    first.file,
    undefined,
    () => now,
  );
  await manager.init(false);
  t.after(() => manager.close());
  assert.equal(manager.view().policy.enabled, false);
  assert.ok(!JSON.stringify(manager.preview(policy)).includes('sensitive'));
  const preview = manager.preview(policy);
  await manager.save(policy, preview.token);
  assert.equal(first.store.get(old.id!)!.log, '');
  assert.equal(first.store.get(oldest.id!)!.logPruned?.bytes, 600000);
  assert.equal(first.store.get(active.id!)!.log, 'active secret output');
  assert.equal(second.store.get(newest.id!)!.log.length, 600000);
  assert.equal(second.store.get(future.id!)!.log, future.log);
  release();
  await first.store.wait('active');
  assert.equal(manager.view().lastRun?.removedLogs, 2);
  const persisted = JSON.parse(await readFile(join(first.folder, 'history.json'), 'utf8'));
  assert.equal(persisted[0].title, old.title);
  assert.equal(persisted[0].log, '');
  assert.ok(persisted[0].logPruned.at);
});

test('saved policy resumes after restart, pauses for migration, and clears no results or task metadata', async (t) => {
  const data = await setup(t, []);
  const done = data.store.start('output', async (log, _signal, _update, result) => {
    log('expire me');
    await result({ artifact: 'RESULT_RETAINS_ITS_OWN_POLICY' });
  });
  await data.store.wait('output');
  done.finishedAt = new Date(now - 20 * day).toISOString();
  let blocked = false,
    active = 0;
  const manager = new LogRetention(
    () => [data.store],
    data.file,
    () => blocked,
    () => now,
    (delta) => {
      active += delta;
    },
  );
  await manager.init(false);
  const saved = await manager.save(policy, manager.preview(policy).token);
  assert.equal(active, 0);
  assert.equal(saved.lastRun?.removedLogs, 1);
  assert.deepEqual(await data.store.result(done.id!), { artifact: 'RESULT_RETAINS_ITS_OWN_POLICY' });
  assert.equal(data.store.get(done.id!)?.status, 'done');
  await manager.close();
  const reopened = new LogRetention(
    () => [data.store],
    data.file,
    () => blocked,
    () => now,
  );
  t.after(() => reopened.close());
  await reopened.init(false);
  assert.equal(reopened.view().policy.enabled, true);
  const later = data.store.start('later', async (log) => {
    log('later output');
  });
  await data.store.wait('later');
  later.finishedAt = new Date(now - 20 * day).toISOString();
  blocked = true;
  await reopened.sweep();
  assert.equal(later.log, 'later output');
  await assert.rejects(reopened.save(policy, reopened.preview(policy).token), /迁移/);
  blocked = false;
  await reopened.sweep();
  assert.equal(later.log, '');
  await reopened.close();
  await assert.rejects(reopened.sweep(), /关闭/);
});

test('stale previews, changed policies and changed log bodies cannot authorize a different cleanup', async (t) => {
  const old = job(20),
    data = await setup(t, [old]);
  const manager = new LogRetention(
    () => [data.store],
    data.file,
    undefined,
    () => now,
  );
  t.after(() => manager.close());
  await manager.init(false);
  const preview = manager.preview(policy);
  const actual = data.store.get(old.id!)!;
  actual.log = 'newer evidence';
  await assert.rejects(manager.save(policy, preview.token), /重新预览/);
  assert.equal(manager.view().policy.enabled, false);
  assert.equal(actual.log, 'newer evidence');
  const keep = { ...policy, enabled: false };
  const pending = manager.preview(keep);
  await manager.save({ ...keep, days: 90 }, manager.preview({ ...keep, days: 90 }).token);
  await assert.rejects(manager.save(keep, pending.token), /重新预览/);
  const cleared = await data.store.clearCompletedLogs(
    [{ id: old.id!, signature: hash(old.log) }],
    new Date(now).toISOString(),
  );
  assert.equal(cleared.removedLogs, 0);
  assert.equal(actual.log, 'newer evidence');
  for (const bad of [
    { ...policy, days: 0 },
    { ...policy, maxMiB: -1 },
    { ...policy, extra: true },
  ])
    assert.equal(logRetentionPolicy.safeParse(bad).success, false);
});

test('history persistence failure restores the in-memory log and exposes incomplete cleanup for retry', async (t) => {
  const old = job(20),
    data = await setup(t, [old]);
  const original = data.store.flush.bind(data.store);
  data.store.flush = async () => {
    data.store.persistenceError = 'simulated disk error';
  };
  const manager = new LogRetention(
    () => [data.store],
    data.file,
    undefined,
    () => now,
  );
  t.after(() => manager.close());
  await manager.init(false);
  await assert.rejects(manager.save(policy, manager.preview(policy).token), /未全部完成/);
  assert.equal(data.store.get(old.id!)?.log, old.log);
  assert.ok(manager.view().warning);
  data.store.flush = original;
  await manager.sweep();
  assert.equal(data.store.get(old.id!)?.log, '');
  assert.equal(manager.view().warning, undefined);
});

test('invalid persisted settings fail closed and a failed policy write never starts cleanup', async (t) => {
  const old = job(20),
    data = await setup(t, [old]);
  await writeFile(data.file, '{invalid');
  const manager = new LogRetention(
    () => [data.store],
    data.file,
    undefined,
    () => now,
  );
  await manager.init(false);
  t.after(() => manager.close());
  assert.equal(manager.view().policy.enabled, false);
  assert.ok(manager.view().warning);
  await manager.sweep();
  assert.equal(data.store.get(old.id!)?.log, old.log);
  const badFile = join(data.folder, 'plain-file');
  await writeFile(badFile, 'not a directory');
  const failing = new LogRetention(
    () => [data.store],
    join(badFile, 'policy.json'),
    undefined,
    () => now,
  );
  await failing.init(false);
  t.after(() => failing.close());
  await assert.rejects(failing.save(policy, failing.preview(policy).token));
  assert.equal(failing.view().policy.enabled, false);
  assert.equal(data.store.get(old.id!)?.log, old.log);
});

test('the minute scheduler applies the durable policy and shutdown drains an admitted cleanup', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const data = await setup(t, []);
  const manager = new LogRetention(
    () => [data.store],
    data.file,
    undefined,
    () => now,
  );
  await manager.init();
  t.after(() => manager.close());
  await manager.save(policy, manager.preview(policy).token);
  const later = data.store.start('scheduled-output', async (log) => {
    log('scheduler expiry');
  });
  await data.store.wait('scheduled-output');
  later.finishedAt = new Date(now - 20 * day).toISOString();
  t.mock.timers.tick(59999);
  assert.equal(later.log, 'scheduler expiry');
  t.mock.timers.tick(1);
  await manager.close();
  assert.equal(later.log, '');
  assert.equal(manager.view().lastRun?.removedLogs, 1);
});
