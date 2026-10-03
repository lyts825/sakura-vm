import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../shared/errors.ts';
import { HostRuntime, hostRuntime } from '../server/host-runtime/index.ts';
import { Jobs } from '../server/jobs.ts';
import { captureOperationCheck, withOperationCheck } from '../server/operation-context.ts';

const request = { owner: 'test:operation', kind: 'test', label: 'operation', cost: { jobs: 1 } };
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const denied = () => new AppError('Permission revoked', 403, 'TEST_REVOKED');

test('queued resources revalidate their original operation and release every dimension on revocation', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const active = await runtime.acquire(request);
  let allowed = true;
  const waiting = withOperationCheck(async () => { if (!allowed) throw denied(); }, () =>
    runtime.acquire({ ...request, partitions: [{ key: 'operation', limit: 1 }] }));
  const rejected = assert.rejects(waiting, { code: 'TEST_REVOKED' });
  allowed = false;
  active.release();
  await rejected;
  assert.equal(runtime.snapshot().resources.length, 0);
  assert.equal(runtime.snapshot().budgets.length, 1);
  assert.equal(runtime.snapshot().budgets[0].used, 0);
  runtime.close();
});

test('cancellation during asynchronous authorization returns the granted resource without executing work', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const entered = gate(), release = gate(), abort = new AbortController();
  const pending = withOperationCheck(async () => { entered.resolve(); await release.promise; }, () =>
    runtime.acquire({ ...request, signal: abort.signal }));
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise;
  assert.equal(runtime.snapshot().budgets[0].used, 1);
  abort.abort(); release.resolve(); await rejected;
  runtime.close();
});

test('permission checks do not recursively inherit themselves, and trusted control cleanup remains available', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 2 } } });
  let checks = 0;
  const lease = await withOperationCheck(async () => {
    ++checks;
    (await runtime.acquire(request)).release();
  }, () => runtime.acquire(request));
  assert.equal(checks, 1); lease.release();
  const control = await withOperationCheck(async () => { throw denied(); }, () =>
    runtime.acquire({ ...request, lane: 'control' }));
  control.release(); runtime.close();
});

test('nested job siblings revalidate after their delegated queue without releasing the parent slot', async () => {
  const jobs = new Jobs(), entered = gate(), release = gate(), queued = gate();
  let allowed = true, ran = false;
  try {
    const parent = jobs.track('parent', async () => {
      const first = jobs.track('first', async () => { entered.resolve(); await release.promise; });
      const second = withOperationCheck(async () => { if (!allowed) throw denied(); }, () =>
        jobs.track('second', async () => { ran = true; }));
      const rejected = assert.rejects(second, { code: 'TEST_REVOKED' });
      queued.resolve(); await first; await rejected;
      assert.equal(hostRuntime.snapshot().budgets.find((b) => b.key === 'jobs')?.used, 1);
    });
    await queued.promise; await entered.promise;
    allowed = false; release.resolve(); await parent;
    assert.equal(ran, false);
    assert.equal(jobs.view('second')?.executionStartedAt, undefined);
    assert.equal(hostRuntime.snapshot().budgets.find((b) => b.key === 'jobs')?.used, 0);
  } finally { release.resolve(); await jobs.close(); }
});

test('root jobs reject revoked authority while trusted cleanup and detached schedules have independent lifetimes', async () => {
  const jobs = new Jobs(); let checks = 0, ran = false;
  try {
    await withOperationCheck(async () => { ++checks; throw denied(); }, async () => {
      await assert.rejects(jobs.track('revoked', async () => { ran = true; }), { code: 'TEST_REVOKED' });
      await jobs.track('cleanup', async () => {}, { lane: 'control' });
      await Jobs.detached(() => jobs.track('schedule', async () => { await captureOperationCheck()(); }));
    });
    assert.equal(checks, 1);
    assert.equal(ran, false);
    assert.equal(hostRuntime.snapshot().budgets.find((b) => b.key === 'jobs')?.used, 0);
  } finally { await jobs.close(); }
});
