import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Scheduler } from '../server/scheduler.ts';
import { Jobs } from '../server/jobs.ts';
import { hostRuntime, resourceContext, withResourceContext } from '../server/host-runtime/index.ts';
import { AppError } from '../shared/errors.ts';

function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
async function eventually(check: () => boolean) { const end = Date.now() + 2000;
  while (!check()) { assert.ok(Date.now() < end, 'Scheduler did not settle'); await delay(5); } }

test('periodic work owns its budget independently of the registering job and actor', async () => {
  const scheduler = new Scheduler(), jobs = new Jobs(), entered = gate(), release = gate();
  let actor: string | undefined, owner: string | undefined;
  const handle = scheduler.register({ owner: 'plugin:periodic', label: 'Independent fixture', intervalMs: 60000,
    run: async () => { actor = resourceContext()?.actorId; owner = resourceContext()?.owner; entered.resolve(); await release.promise; } });
  try {
    await withResourceContext({ actorId: 'registrant', vmId: 'old-vm' }, () => jobs.track('register', async () => {
      handle.trigger(); await entered.promise;
      assert.equal(actor, undefined); assert.equal(owner, 'plugin:periodic');
      assert.equal(hostRuntime.snapshot().budgets.find(budget => budget.key === 'jobs')?.used, 2);
      // The registering task can finish while the schedule remains active.
    }));
    assert.equal(handle.snapshot().state, 'running');
    release.resolve(); await scheduler.close(); await jobs.close();
  } finally { release.resolve(); await scheduler.close(); await jobs.close(); }
});

test('application drain stops new schedules and exposes cancellation until physical work finishes', async () => {
  const scheduler = new Scheduler(), entered = gate(), release = gate();
  let signal: AbortSignal | undefined;
  const handle = scheduler.register({ owner: 'test:drain', label: 'Drain fixture', intervalMs: 60000,
    run: async (context) => { signal = context.signal; entered.resolve(); await release.promise; } });
  try {
    handle.trigger(); await entered.promise;
    scheduler.beginDrain();
    assert.equal(signal?.aborted, true);
    assert.equal(handle.snapshot().state, 'cancelling');
    assert.equal(handle.trigger(), false);
    assert.throws(() => scheduler.register({ owner: 'test:late', label: 'Late', intervalMs: 10, run: async () => {} }),
      { code: 'SCHEDULER_CLOSED' });
    let closed = false;
    const closing = scheduler.close().then(() => { closed = true; });
    await delay(10); assert.equal(closed, false);
    release.resolve(); await closing;
    assert.deepEqual(scheduler.snapshot(), []);
  } finally { release.resolve(); await scheduler.close(); }
});

test('overlapping triggers coalesce into one followup while skip never overlaps', async () => {
  const scheduler = new Scheduler(), entered = gate(), release = gate(); let runs = 0, active = 0, peak = 0;
  const handle = scheduler.register({ owner: 'test:coalesce', label: 'Coalesced fixture', intervalMs: 60_000,
    overlap: 'coalesce', run: async () => {
      runs++; peak = Math.max(peak, ++active); if (runs === 1) { entered.resolve(); await release.promise; } active--;
    } });
  try {
    handle.trigger(); await entered.promise;
    for (let i = 0; i < 20; i++) assert.equal(handle.trigger(), true);
    assert.equal(handle.snapshot().coalesced, 20); release.resolve();
    await eventually(() => runs === 2 && handle.snapshot().state === 'scheduled'); assert.equal(peak, 1);
    const hold = gate(), started = gate();
    const skipped = scheduler.register({ owner: 'test:skip', label: 'Skipped fixture', intervalMs: 60_000,
      overlap: 'skip', run: async () => { started.resolve(); await hold.promise; } });
    skipped.trigger(); await started.promise; assert.equal(skipped.trigger(), false); assert.equal(skipped.snapshot().skipped, 1);
    hold.resolve(); await skipped.close();
  } finally { release.resolve(); await scheduler.close(); }
});

test('timeout aborts cooperatively, retains the slot during cleanup, and close is idempotent', async () => {
  const scheduler = new Scheduler(), entered = gate(), aborted = gate(), cleanup = gate();
  const handle = scheduler.register({ owner: 'test:timeout', label: 'Timeout fixture', intervalMs: 60_000, timeoutMs: 20,
    run: async ({ signal }) => {
      entered.resolve(); await new Promise<void>((resolve) => signal.addEventListener('abort', () => { aborted.resolve(); resolve(); }, { once: true }));
      assert.equal(signal.reason.code, 'SCHEDULE_TIMEOUT'); await cleanup.promise;
    } });
  try {
    handle.trigger(); await entered.promise; await aborted.promise;
    assert.equal(handle.snapshot().state, 'cancelling'); assert.ok(handle.snapshot().timedOutAt);
    assert.equal(hostRuntime.snapshot().budgets.find((budget) => budget.key === 'jobs')?.used, 1);
    let closed = false; const closing = scheduler.close(); assert.equal(scheduler.close(), closing);
    void closing.then(() => { closed = true; }); await delay(10); assert.equal(closed, false);
    cleanup.resolve(); await closing; assert.equal(closed, true); assert.deepEqual(scheduler.snapshot(), []);
    assert.equal(handle.trigger(), false);
  } finally { cleanup.resolve(); await scheduler.close(); }
});

test('failure backoff delays a coalesced retry and success resets diagnostics', async () => {
  const scheduler = new Scheduler(); let runs = 0;
  const handle = scheduler.register({ owner: 'test:backoff', label: 'Backoff fixture', intervalMs: 10,
    overlap: 'coalesce', backoff: { initialMs: 80, maxMs: 160 }, run: async () => {
      if (++runs === 1) throw new Error('fixture failure');
    } });
  try {
    handle.trigger(); await eventually(() => handle.snapshot().state === 'backoff');
    assert.equal(handle.snapshot().lastError, 'fixture failure'); handle.trigger();
    await delay(30); assert.equal(runs, 1);
    await eventually(() => runs >= 2); await eventually(() => handle.snapshot().failures === 0);
    assert.equal(handle.snapshot().lastError, undefined);
  } finally { await scheduler.close(); }
});

test('late wakeups skip or run at most one catchup instead of replaying every missed tick', async () => {
  const scheduler = new Scheduler(); let skipped = 0, caught = 0;
  scheduler.register({ owner: 'test:missed-skip', label: 'Skip missed ticks', intervalMs: 10, catchUp: 'skip',
    run: async () => { skipped++; } });
  scheduler.register({ owner: 'test:missed-once', label: 'Coalesce missed ticks', intervalMs: 10, catchUp: 'once',
    run: async () => { caught++; } });
  try {
    const until = performance.now() + 65; while (performance.now() < until) { /* simulate a suspended event loop */ }
    await delay(1);
    assert.equal(skipped, 0); assert.equal(caught, 1);
    assert.ok(scheduler.snapshot().every((view) => view.skipped >= 5));
  } finally { await scheduler.close(); }
});

test('scheduled work delegates nested Jobs without consuming a second execution slot', async () => {
  const scheduler = new Scheduler(), jobs = new Jobs(), complete = gate();
  const handle = scheduler.register({ owner: 'test:nested-schedule', label: 'Nested fixture', intervalMs: 60_000,
    run: async () => { await jobs.track('child', async () => {
      assert.equal(hostRuntime.snapshot().budgets.find((budget) => budget.key === 'jobs')?.used, 1);
    }); complete.resolve(); } });
  try { handle.trigger(); await complete.promise; assert.ok(jobs.view('child')?.delegatedFrom); }
  finally { await scheduler.close(); await jobs.close(); }
});

test('scheduler shutdown also waits for registrations already being closed', async () => {
  const scheduler = new Scheduler(), entered = gate(), release = gate();
  const handle = scheduler.register({ owner: 'test:closing', label: 'Closing fixture', intervalMs: 60_000,
    run: async () => { entered.resolve(); await release.promise; } });
  try {
    handle.trigger(); await entered.promise;
    const handleClose = handle.close(); let closed = false;
    const closing = scheduler.close(); void closing.then(() => { closed = true; });
    await delay(10); assert.equal(closed, false);
    release.resolve(); await Promise.all([handleClose, closing]); assert.equal(closed, true);
  } finally { release.resolve(); await scheduler.close(); }
});

test('timed-out cleanup failures retain scheduler registration until explicit domain recovery and a close retry', async () => {
  const scheduler = new Scheduler(), entered = gate();
  const handle = scheduler.register({ owner: 'test:cleanup-failure', label: 'Pending cleanup fixture', intervalMs: 60_000, timeoutMs: 10,
    run: async ({ signal }) => {
      entered.resolve(); await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      throw new AppError('Underlying process cleanup unconfirmed', 503, 'HOST_PROCESS_CLEANUP_PENDING');
    } });
  handle.trigger(); await entered.promise; await eventually(() => handle.snapshot().state === 'cleanup-pending');
  assert.equal(handle.snapshot().lastError, 'Underlying process cleanup unconfirmed');
  assert.equal(handle.trigger(), false);
  await assert.rejects(scheduler.close(), { code: 'HOST_PROCESS_CLEANUP_PENDING' });
  assert.equal(scheduler.snapshot().length, 1);
  assert.ok(hostRuntime.snapshot().resources.some((resource) => resource.kind === 'schedule' &&
    resource.owner === 'test:cleanup-failure' && resource.state === 'cleanup-pending'));
  await handle.resolveCleanup(handle.snapshot().jobId!);
  await scheduler.close(); assert.deepEqual(scheduler.snapshot(), []);
  assert.equal(hostRuntime.snapshot().resources.some((resource) => resource.owner === 'test:cleanup-failure'), false);
});
