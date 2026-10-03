import assert from 'node:assert/strict';
import test from 'node:test';
import { HostRuntime, withResourceContext, resourceContext, captureResourceContext } from '../server/host-runtime/index.ts';
import { ResourceScope } from '../server/resource-scope.ts';

const request = (owner: string, cost: Record<string, number> = { jobs: 1 }) => ({ owner, kind: 'test', label: 'owned test', cost });
const immediate = () => new Promise<void>(resolve => setImmediate(resolve));

test('atomic admission never holds an available dimension while queued for another', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 }, io: { capacity: 1 } } });
  const io = await runtime.acquire(request('disk', { io: 1 }));
  const blocked = runtime.acquire(request('both', { jobs: 1, io: 1 }));
  const independent = await runtime.acquire(request('job'));
  assert.equal(runtime.snapshot().queued, 1);
  independent.release();
  assert.equal(runtime.snapshot().budgets.find(b => b.key === 'jobs')?.used, 0);
  io.release();
  const both = await blocked;
  assert.ok(runtime.snapshot().budgets.every(b => b.used === 1));
  both.release(); both.release();
  assert.ok(runtime.snapshot().budgets.every(b => b.used === 0));
  runtime.close();
});

test('control has reserved execution and queue capacity when ordinary work is saturated', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 2, reserved: 1 } }, queueLimit: 2, controlQueueReserve: 1 });
  const active = await runtime.acquire(request('active'));
  const waiting = runtime.acquire(request('waiting'));
  await assert.rejects(runtime.acquire(request('overflow')), { code: 'RESOURCE_QUEUE_FULL' });
  const control = await runtime.acquire({ ...request('cleanup'), lane: 'control' });
  assert.equal(runtime.snapshot().budgets[0].used, 2);
  control.release();
  assert.equal(runtime.snapshot().queued, 1);
  active.release();
  (await waiting).release();
  runtime.close();
});

test('owners alternate under contention and cancelling a waiter consumes no capacity', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const active = await runtime.acquire(request('a'));
  const a = runtime.acquire(request('a'));
  const abort = new AbortController();
  const cancelled = runtime.acquire({ ...request('cancelled'), signal: abort.signal });
  const rejected = assert.rejects(cancelled, { name: 'AbortError' });
  const b = runtime.acquire(request('b'));
  abort.abort(); await rejected;
  active.release();
  const other = await b;
  assert.equal(runtime.snapshot().resources.find(v => v.state === 'active')?.owner, 'b');
  other.release(); (await a).release();
  assert.equal(runtime.snapshot().totals.cancelled, 1);
  runtime.close();
});

test('partition budgets span owners and disappear only after active and queued references end', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 4 } } });
  const partitions = [{ key: 'volume:one', limit: 1 }];
  const first = await runtime.acquire({ ...request('backup'), partitions });
  const second = runtime.acquire({ ...request('sync'), partitions });
  await assert.rejects(runtime.acquire({ ...request('bad'), partitions: [{ key: 'volume:one', limit: 2 }] }), { code: 'RESOURCE_PARTITION_CONFLICT' });
  first.release(); (await second).release();
  assert.equal(runtime.snapshot().budgets.length, 1);
  const resized = await runtime.acquire({ ...request('new'), partitions: [{ key: 'volume:one', limit: 2 }] });
  resized.release(); runtime.close();
});

test('cancelled active work and failed cleanup retain capacity until its owner confirms release', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const abort = new AbortController();
  const lease = await runtime.acquire({ ...request('process'), signal: abort.signal });
  abort.abort(); lease.cleanupPending(new Error('physical process exit unconfirmed'));
  assert.equal(runtime.snapshot().budgets[0].used, 1);
  assert.equal(runtime.snapshot().resources[0].state, 'cleanup-pending');
  assert.throws(() => runtime.close(), { code: 'RESOURCE_CLEANUP_PENDING' });
  lease.release(); runtime.close();
  assert.equal(runtime.snapshot().state, 'closed');
});

test('drain rejects queued and new work but admits bounded cleanup until close', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 2, reserved: 1 } } });
  const lease = await runtime.acquire(request('owned'));
  const waiting = runtime.acquire(request('queued'));
  const rejected = assert.rejects(waiting, { code: 'RESOURCE_DRAINING' });
  runtime.beginDrain(); await rejected;
  await assert.rejects(runtime.acquire(request('late')), { code: 'RESOURCE_DRAINING' });
  const cleanup = await runtime.acquire({ ...request('cleanup'), lane: 'control' });
  cleanup.release(); lease.release(); runtime.close();
  await assert.rejects(runtime.acquire({ ...request('closed'), lane: 'control' }), { code: 'RESOURCE_DRAINING' });
});

test('queue deadlines free listeners, registry entries and partition references', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const lease = await runtime.acquire(request('active'));
  await assert.rejects(runtime.acquire({ ...request('deadline'), timeoutMs: 10,
    partitions: [{ key: 'temporary', limit: 1 }] }), { code: 'RESOURCE_WAIT_TIMEOUT' });
  assert.equal(runtime.snapshot().queued, 0);
  assert.equal(runtime.snapshot().budgets.length, 1);
  lease.release(); runtime.close();
});

test('invalid costs and partition declarations cannot alter budget accounting', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  for (const value of [0, -1, NaN, Infinity, 0.5])
    await assert.rejects(runtime.acquire(request('invalid', { jobs: value })), { code: 'RESOURCE_INVALID' });
  await assert.rejects(runtime.acquire(request('large', { jobs: 2 })), { code: 'RESOURCE_CAPACITY' });
  await assert.rejects(runtime.acquire(request('unknown', { unknown: 1 })), { code: 'RESOURCE_INVALID' });
  await assert.rejects(runtime.acquire({ ...request('duplicate'), partitions: [{ key: 'same', limit: 1 }, { key: 'same', limit: 1 }] }), { code: 'RESOURCE_INVALID' });
  assert.equal(runtime.snapshot().resources.length, 0);
  assert.equal(runtime.snapshot().budgets.length, 1);
  runtime.close();
});

test('resource identities survive async boundaries without crossing unrelated requests', async () => {
  const runtime = new HostRuntime();
  const contexts = await Promise.all(['alice', 'bob'].map(actorId => withResourceContext({ actorId, owner: 'plugin:owned', vmId: actorId }, async () => {
    const identity = captureResourceContext();
    await immediate();
    assert.equal(resourceContext()?.operationId, identity.operationId);
    const lease = runtime.register({ owner: 'plugin:owned', kind: 'test', label: actorId });
    const view = runtime.snapshot().resources.find(v => v.id === lease.id)!;
    lease.release(); return view.identity;
  })));
  assert.equal(contexts[0].actorId, 'alice');
  assert.equal(contexts[1].actorId, 'bob');
  assert.notEqual(contexts[0].operationId, contexts[1].operationId);
  assert.equal(resourceContext(), undefined);
  runtime.close();
});

test('ownership transfer and snapshot mutation cannot release or overwrite another lease', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const lease = await runtime.acquire(request('launcher'));
  lease.transfer('user:application');
  const snapshot = runtime.snapshot();
  snapshot.resources[0].owner = 'changed';
  snapshot.resources[0].identity.owner = 'changed';
  assert.equal(runtime.snapshot().resources[0].owner, 'user:application');
  assert.equal(runtime.snapshot().resources[0].previousOwner, 'launcher');
  assert.equal(runtime.snapshot().budgets[0].used, 1);
  lease.release();
  assert.throws(() => lease.transfer('late'), { code: 'RESOURCE_RELEASED' });
  runtime.close();
});

test('scope cleanup failure stays registered and explicit retry only retries failed resources', async () => {
  const runtime = new HostRuntime(), scope = new ResourceScope({ owner: 'vm:one', registry: runtime });
  let attempts = 0, successful = 0;
  scope.defer('failed attachment', () => { if (++attempts === 1) throw new Error('still running'); });
  scope.defer('successful attachment', () => { ++successful; });
  await assert.rejects(scope.close(), AggregateError);
  assert.equal(scope.signal.aborted, true);
  assert.equal(runtime.snapshot().resources.length, 1);
  assert.equal(runtime.snapshot().resources[0].state, 'cleanup-pending');
  await scope.retryCleanup();
  assert.equal(attempts, 2); assert.equal(successful, 1);
  runtime.close();
});

test('nested scopes propagate cancellation and shutdown awaits child disposal', async () => {
  const runtime = new HostRuntime(), parent = new ResourceScope({ owner: 'app', registry: runtime });
  const child = parent.child('vm', 0, 'vm:one');
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  child.defer('owned process', () => waiting);
  const closing = parent.close();
  await immediate();
  assert.equal(parent.signal.aborted, true); assert.equal(child.signal.aborted, true);
  assert.equal(runtime.snapshot().resources.length, 2);
  finish(); await closing; runtime.close();
});

test('parent cleanup retry reaches failed descendants without losing their ownership', async () => {
  const runtime = new HostRuntime(), parent = new ResourceScope({ owner: 'app', registry: runtime });
  const child = parent.child('vm');
  let calls = 0;
  child.defer('attachment', () => { if (++calls === 1) throw new Error('failed once'); });
  await assert.rejects(parent.close(), AggregateError);
  assert.equal(runtime.snapshot().resources.length, 2);
  await parent.retryCleanup();
  assert.equal(calls, 2); runtime.close();
});

test('identities are whitelisted before diagnostics and invalid context cannot leak a registry entry', async () => {
  const runtime = new HostRuntime();
  const identity = { owner: 'plugin:one', password: 'never expose', argv: ['secret'] };
  const lease = runtime.register({ owner: 'plugin:one', kind: 'test', label: 'owned', identity });
  assert.equal(JSON.stringify(runtime.snapshot()).includes('never expose'), false);
  assert.equal(JSON.stringify(runtime.snapshot()).includes('argv'), false);
  lease.release();
  assert.throws(() => runtime.register({ owner: 'valid', kind: 'test', label: 'owned', identity: { actorId: '\ninvalid' } }), /Invalid resource identity/);
  assert.equal(runtime.snapshot().resources.length, 0);
  runtime.close();
});

test('bounded owner queues protect unrelated owners and reject callbacks cannot strand resources', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } }, ownerQueueLimit: 1 });
  const lease = await runtime.acquire(request('active'));
  const queued = runtime.acquire(request('flood'));
  await assert.rejects(runtime.acquire(request('flood')), { code: 'RESOURCE_QUEUE_FULL' });
  await assert.rejects(runtime.acquire({ ...request('callback'), onQueued() { throw new Error('observer failed'); } }), /observer failed/);
  const other = runtime.acquire(request('other'));
  lease.release(); (await queued).release(); (await other).release();
  assert.equal(runtime.snapshot().queued, 0); runtime.close();
});

test('lease resize checks all held dimensions atomically and rejects new dimensions', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 4 }, io: { capacity: 4 } } });
  const first = await runtime.acquire(request('first', { jobs: 1, io: 1 }));
  const second = await runtime.acquire(request('second', { io: 2 }));
  assert.throws(() => first.resize({ jobs: 3, io: 3 }), { code: 'RESOURCE_CAPACITY' });
  assert.deepEqual(runtime.snapshot().resources.find(v => v.id === first.id)?.cost, { jobs: 1, io: 1 });
  assert.deepEqual(runtime.snapshot().budgets.map(v => v.used), [1, 3]);
  assert.throws(() => second.resize({ jobs: 1 }), { code: 'RESOURCE_INVALID' });
  for (const amount of [-1, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => first.resize({ jobs: amount }), { code: 'RESOURCE_INVALID' });
  first.resize({ jobs: 3, io: 2 });
  assert.deepEqual(runtime.snapshot().budgets.map(v => v.used), [3, 4]);
  first.release(); second.release(); runtime.close();
});

test('shrinking a lease wakes queued work and zero-cost partitions retain their definition', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const first = await runtime.acquire({ ...request('first'), partitions: [{ key: 'temporary', limit: 10, amount: 10 }] });
  const waiting = runtime.acquire({ ...request('waiting'), partitions: [{ key: 'temporary', limit: 10, amount: 5 }] });
  first.resize({ jobs: 0, 'partition:temporary': 0 });
  const second = await waiting;
  assert.equal(runtime.snapshot().budgets.find(v => v.key === 'partition:temporary')?.used, 5);
  second.release();
  assert.ok(runtime.snapshot().budgets.some(v => v.key === 'partition:temporary'));
  await assert.rejects(runtime.acquire({ ...request('conflict'), partitions: [{ key: 'temporary', limit: 11 }] }), { code: 'RESOURCE_PARTITION_CONFLICT' });
  first.resize({ jobs: 1, 'partition:temporary': 10 });
  first.release();
  assert.ok(!runtime.snapshot().budgets.some(v => v.key === 'partition:temporary'));
  runtime.close();
});

test('resize preserves control reserve while allowing reductions under control pressure', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 4, reserved: 2 } } });
  const ordinary = await runtime.acquire(request('ordinary'));
  ordinary.resize({ jobs: 2 });
  assert.throws(() => ordinary.resize({ jobs: 3 }), { code: 'RESOURCE_CAPACITY' });
  const control = await runtime.acquire({ ...request('control'), lane: 'control' });
  control.resize({ jobs: 2 });
  ordinary.resize({ jobs: 1 });
  assert.equal(runtime.snapshot().budgets[0].used, 3);
  assert.throws(() => ordinary.resize({ jobs: 2 }), { code: 'RESOURCE_CAPACITY' });
  ordinary.release(); control.release(); runtime.close();
});

test('cleanup-pending and released leases cannot change their reserved amounts', async () => {
  const runtime = new HostRuntime({ budgets: { jobs: { capacity: 2 } } });
  const lease = await runtime.acquire(request('pending'));
  lease.cleanupPending(new Error('physical close unconfirmed'));
  assert.throws(() => lease.resize({ jobs: 0 }), { code: 'RESOURCE_CLEANUP_PENDING' });
  assert.equal(runtime.snapshot().budgets[0].used, 1);
  lease.release();
  assert.throws(() => lease.resize({ jobs: 1 }), { code: 'RESOURCE_RELEASED' });
  runtime.close();
});
