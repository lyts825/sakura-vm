/**
 * 回归范围（完整情景见下方用例与断言）：
 * - global jobs admission preserves control capacity and cancels queued work without executing it
 * - nested siblings and grandchildren share one slot and preserve resource identity
 * - cancelling a queued sibling does not let later siblings overtake active work
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Jobs } from '../server/jobs.ts';
import { AppError } from '../shared/errors.ts';
import { hostRuntime, resourceContext } from '../server/host-runtime/index.ts';

const parent = await realpath(tmpdir()), directory = await mkdtemp(join(parent, 'sakura-job-admission-'));
after(async () => { const path = await realpath(directory); assert.equal(dirname(path), parent);
  assert.match(basename(path), /^sakura-job-admission-/); await rm(path, { recursive: true, force: true }); });
function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
async function eventually(check: () => boolean) { const end = Date.now() + 3000;
  while (!check()) { assert.ok(Date.now() < end, 'Jobs did not settle'); await delay(5); } }
const used = () => hostRuntime.snapshot().budgets.find((budget) => budget.key === 'jobs')!.used;

test('global jobs admission preserves control capacity and cancels queued work without executing it', async () => {
  const jobs = new Jobs(), entered = gate(), cleanup = gate(); let active = 0, executed = false;
  try {
    for (let i = 0; i < 14; i++) jobs.start('run-' + i, async (_log, signal) => {
      if (++active === 14) entered.resolve();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      await cleanup.promise;
    });
    await entered.promise; assert.equal(used(), 14);
    const queued = jobs.start('queued', async () => { executed = true; });
    await delay(10); assert.equal(queued.status, 'running'); assert.equal(queued.admission, 'queued');
    assert.ok(queued.queuedAt); assert.equal(queued.executionStartedAt, undefined);
    assert.throws(() => jobs.start('queued', async () => {}), { status: 409 });
    await jobs.track('control', async () => { assert.equal(used(), 15); }, { lane: 'control' });
    jobs.cancel('queued'); await jobs.wait('queued'); assert.equal(executed, false); assert.equal(queued.status, 'cancelled');
    const closing = jobs.close(); assert.equal(jobs.close(), closing);
    await delay(10); assert.equal(used(), 14); cleanup.resolve(); await closing; assert.equal(used(), 0);
  } finally { cleanup.resolve(); await jobs.close(); }
});

test('nested siblings and grandchildren share one slot and preserve resource identity', async () => {
  const jobs = new Jobs(), events: string[] = []; let peak = 0;
  try {
    const result = await jobs.track('parent', async () => {
      const a = jobs.track('a', async () => {
        events.push('a'); peak = Math.max(peak, used());
        await jobs.track('grandchild', async () => {
          peak = Math.max(peak, used()); events.push('grandchild');
          assert.equal(resourceContext()?.vmId, 'vm-test');
        }, { vmId: 'vm-test' });
        await delay(5); events.push('a-done'); return 'A';
      });
      const b = jobs.track('b', async () => { events.push('b'); peak = Math.max(peak, used()); return 'B'; });
      return await Promise.all([a, b]);
    }, { vmId: 'vm-test' });
    assert.deepEqual(result, ['A', 'B']); assert.deepEqual(events, ['a', 'grandchild', 'a-done', 'b']); assert.equal(peak, 1);
    assert.equal(jobs.view('a')?.delegatedFrom, jobs.view('parent')?.id);
    assert.equal(jobs.view('b')?.resourceLeaseId, jobs.view('parent')?.resourceLeaseId);
    assert.equal(used(), 0);
  } finally { await jobs.close(); }
});

test('cancelling a queued sibling does not let later siblings overtake active work', async () => {
  const jobs = new Jobs(), entered = gate(), release = gate(), queued = gate(); const events: string[] = [];
  try {
    const parentTask = jobs.track('parent', async () => {
      const a = jobs.track('a', async () => { entered.resolve(); await release.promise; events.push('a'); });
      const b = jobs.track('b', async () => { events.push('b'); });
      const cancelled = assert.rejects(b, /取消/);
      const c = jobs.track('c', async () => { events.push('c'); });
      queued.resolve(); await Promise.all([a, cancelled, c]);
    });
    await queued.promise; await entered.promise; jobs.cancel('b'); await jobs.wait('b');
    assert.deepEqual(events, []); assert.equal(jobs.view('c')?.admission, 'queued');
    release.resolve(); await parentTask; assert.deepEqual(events, ['a', 'c']);
  } finally { release.resolve(); await jobs.close(); }
});

test('parent cancellation waits for delegated cleanup before releasing its only slot', async () => {
  const jobs = new Jobs(), entered = gate(), cleanup = gate(); let cleaned = false;
  try {
    const running = jobs.track('parent', async () => {
      await jobs.track('child', async (_log, signal) => {
        entered.resolve(); await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        await cleanup.promise; cleaned = true;
      });
    });
    const rejected = assert.rejects(running, /取消/); await entered.promise;
    jobs.cancel('parent'); await delay(10); assert.equal(used(), 1); assert.equal(cleaned, false);
    cleanup.resolve(); await rejected; assert.equal(cleaned, true); assert.equal(used(), 0);
  } finally { cleanup.resolve(); await jobs.close(); }
});

test('self waits, later-sibling waits and cross-parent cycles fail instead of deadlocking', async () => {
  const jobs = new Jobs();
  try {
    await assert.rejects(jobs.track('self', async () => { await jobs.wait('self'); }), { code: 'JOB_DEPENDENCY_CYCLE' });
    await assert.rejects(jobs.track('self-close', async () => { await jobs.close(); }), { code: 'JOB_DEPENDENCY_CYCLE' });
    await jobs.track('parent', async () => {
      const a = jobs.track('first', async () => {
        await assert.rejects(jobs.wait('second'), { code: 'JOB_DEPENDENCY_CYCLE' });
      });
      const b = jobs.track('second', async () => {}); await Promise.all([a, b]);
    });
    const readyA = gate(), readyB = gate(); let cycle = false;
    const a = jobs.track('root-a', async () => { readyA.resolve(); await readyB.promise; await jobs.wait('root-b'); });
    const b = jobs.track('root-b', async () => { readyB.resolve(); await readyA.promise;
      try { await jobs.wait('root-a'); } catch (error: any) { assert.equal(error.code, 'JOB_DEPENDENCY_CYCLE'); cycle = true; } });
    await Promise.all([a, b]); assert.equal(cycle, true); assert.equal(used(), 0);
  } finally { await jobs.close(); }
});

test('synchronous root registration and delegated sibling queues are bounded before any work starts', async () => {
  const jobs = new Jobs();
  try {
    for (let i = 0; i < 78; i++) jobs.start('root-' + i, async () => {});
    assert.throws(() => jobs.start('overflow', async () => {}), { code: 'JOB_QUEUE_FULL' });
    jobs.start('root-78', async () => {}, { lane: 'control' });
    jobs.start('root-79', async () => {}, { lane: 'control' });
    assert.throws(() => jobs.start('control-overflow', async () => {}, { lane: 'control' }), { code: 'JOB_QUEUE_FULL' });
    await Promise.all(Array.from({ length: 80 }, (_, i) => jobs.wait('root-' + i)));
    await jobs.track('parent', async () => {
      for (let i = 0; i < 64; i++) jobs.start('child-' + i, async () => {});
      assert.throws(() => jobs.start('child-overflow', async () => {}), { code: 'JOB_QUEUE_FULL' });
    });
    assert.equal(used(), 0);
  } finally { await jobs.close(); }
});

test('process and storage cleanup failures survive cancellation and only their owning Jobs resolves markers', async () => {
  const jobs = new Jobs(), foreign = new Jobs();
  try {
    for (const code of ['HOST_PROCESS_CLEANUP_PENDING', 'STORAGE_CLEANUP_PENDING']) {
      const entered = gate();
      const task = jobs.track(code, async (_log, signal) => {
        entered.resolve(); await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        throw new AppError('Domain cleanup unconfirmed', 503, code);
      });
      const rejected = assert.rejects(task, { code, status: 503 }); await entered.promise; jobs.cancel(code); await rejected;
      const view = jobs.view(code)!; assert.equal(view.admission, 'cleanup-pending'); assert.ok(view.cleanupLeaseId);
      assert.equal(used(), 0);
      await assert.rejects(foreign.resolveCleanup(view.id!), { code: 'JOB_CLEANUP_NOT_FOUND' });
      assert.ok(hostRuntime.snapshot().resources.some((resource) => resource.id === view.cleanupLeaseId && resource.state === 'cleanup-pending'));
      await jobs.resolveCleanup(view.id!); assert.equal(view.admission, undefined); assert.ok(view.cleanupResolvedAt);
      assert.equal(hostRuntime.snapshot().resources.some((resource) => resource.id === view.cleanupLeaseId), false);
      assert.equal(view.status, 'error'); assert.equal(view.errorCode, code);
    }
  } finally { await jobs.close(); await foreign.close(); }
});

test('restarted queued and cancelling histories become interrupted, and history errors remain observational', async () => {
  const file = join(directory, 'restart.json');
  await writeFile(file, JSON.stringify(['queued', 'cancelling'].map((admission, i) => ({ id: String(i), key: String(i),
    status: 'running', admission, startedAt: new Date().toISOString(), log: '' }))));
  const restored = new Jobs('restart', directory);
  assert.ok(restored.list().every((job) => job.status === 'interrupted' && job.admission === undefined)); await restored.close();
  const blocked = join(directory, 'not-a-directory'); await writeFile(blocked, 'fixture');
  const jobs = new Jobs('observational', blocked); let executed = false;
  await jobs.track('run', async () => { executed = true; });
  assert.equal(executed, true); assert.ok(jobs.persistenceError); await jobs.close();
  assert.equal((JSON.parse(await readFile(file, 'utf8')) as any[]).every((job) => job.status === 'interrupted'), true);
});
