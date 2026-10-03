import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ResourceCache, type ResourceRequest, type ResourceSnapshot } from '../src/resource-cache.ts';
import { jobPresentation } from '../src/job-presentation.ts';
import type { JobView } from '../shared/contracts/jobs.ts';

function gate<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
async function until(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) { assert.ok(Date.now() < deadline, 'Resource cache did not settle'); await delay(1); }
}

test('observers of the same resource share a read; one unmount cannot cancel another observer', async () => {
  const cache = new ResourceCache(), wait = gate<object>();
  let reads = 0, signal: AbortSignal | undefined;
  const request: ResourceRequest = (async (_path, _method, _body, value) => { reads++; signal = value; return wait.promise; }) as ResourceRequest;
  let first: ResourceSnapshot | undefined, second: ResourceSnapshot | undefined;
  const stopFirst = cache.watch(request, '/vms/one?project=one', value => { first = value; }, 0);
  const stopSecond = cache.watch(request, '/vms/one?project=one', value => { second = value; }, 0);
  try {
    await until(() => reads === 1); stopFirst();
    assert.equal(signal?.aborted, false);
    wait.resolve({ value: 'current' }); await until(() => second?.data !== null);
    assert.deepEqual(second?.data, { value: 'current' }); assert.equal(first?.data, null);
    assert.equal(reads, 1);
  } finally { stopFirst(); stopSecond(); cache.close(); }
});

test('invalidation during a read discards stale completion and coalesces a burst into one fresh read', async () => {
  const cache = new ResourceCache(), wait = gate<number>(); let reads = 0;
  const request = (async () => ++reads === 1 ? wait.promise : 2) as ResourceRequest;
  const values: unknown[] = [];
  const stop = cache.watch(request, '/vms/one', value => { if (value.data !== null) values.push(value.data); }, 0);
  try {
    await until(() => reads === 1);
    for (let i = 0; i < 30; i++) cache.invalidate(request, '/vms/one');
    wait.resolve(1); await until(() => values.includes(2));
    assert.equal(reads, 2); assert.equal(values.includes(1), false);
  } finally { stop(); cache.close(); }
});

test('query identity and request capabilities stay separate; last unsubscribe cancels its own read', async () => {
  const cache = new ResourceCache(); const signals: AbortSignal[] = [], paths: string[] = [];
  const wait = gate<object>();
  const request = (async (path: string, _method: string, _body: unknown, signal: AbortSignal) => {
    paths.push(path); signals.push(signal); return wait.promise;
  }) as ResourceRequest;
  const other = request.bind(null) as ResourceRequest;
  const stop = [cache.watch(request, '/vms/one?project=a', () => {}, 0),
    cache.watch(request, '/vms/one?project=b', () => {}, 0), cache.watch(other, '/vms/one?project=a', () => {}, 0)];
  try {
    await until(() => paths.length === 3); stop[0]();
    assert.deepEqual(signals.map(signal => signal.aborted), [true, false, false]);
  } finally { stop.forEach(close => close()); wait.resolve({}); cache.close(); }
});

test('account reset drops cached private data and old requests cannot restore it', async () => {
  const cache = new ResourceCache(), wait = gate<string>(); let reads = 0;
  const request = (async () => ++reads === 1 ? 'account-a' : reads === 2 ? wait.promise : 'account-b') as ResourceRequest;
  let snapshot: ResourceSnapshot | undefined;
  const seen: unknown[] = [];
  const stop = cache.watch(request, '/private', value => { snapshot = value; seen.push(value.data); }, 0);
  try {
    await until(() => snapshot?.data === 'account-a');
    cache.invalidate(); await until(() => reads === 2);
    cache.reset(); assert.equal(snapshot?.data, null);
    seen.length = 0; wait.resolve('stale-private-data');
    await until(() => snapshot?.data === 'account-b');
    assert.equal(seen.includes('stale-private-data'), false);
  } finally { stop(); cache.close(); }
});

test('hidden views pause polling and resume with a full reconciliation of observed keys', async () => {
  const cache = new ResourceCache(); let reads = 0;
  const request = (async () => ++reads) as ResourceRequest;
  cache.setVisible(false);
  const stop = cache.watch(request, '/jobs', () => {}, 5);
  try {
    await delay(15); assert.equal(reads, 0);
    cache.setVisible(true); await until(() => reads > 0);
    cache.setVisible(false); const previous = reads;
    await delay(20); assert.equal(reads, previous);
    cache.setVisible(true); await until(() => reads > previous);
  } finally { stop(); cache.close(); }
});

test('mutation invalidation refreshes the affected VM and summary keys without refetching unrelated projects', async () => {
  const cache = new ResourceCache(); const counts = new Map<string, number>();
  const request = (async (path: string) => { counts.set(path, (counts.get(path) || 0) + 1); return {}; }) as ResourceRequest;
  const paths = ['/vms', '/vms/one/project?project=a', '/vms/two/project?project=b', '/jobs', '/system'];
  const stop = paths.map(path => cache.watch(request, path, () => {}, 0));
  try {
    await until(() => counts.size === paths.length);
    cache.mutation('/vms/one/project');
    await until(() => counts.get('/jobs') === 2);
    assert.equal(counts.get('/vms/two/project?project=b'), 1);
    assert.equal(counts.get('/vms/one/project?project=a'), 2);
  } finally { stop.forEach(close => close()); cache.close(); }
});

test('resource cache bounds retained entries and never evicts an active observer to admit more', () => {
  const cache = new ResourceCache(1), request = (async () => ({})) as ResourceRequest;
  cache.setVisible(false);
  const stop = cache.watch(request, '/one', () => {}, 0);
  try {
    assert.throws(() => cache.watch(request, '/two', () => {}, 0), /上限/);
    stop(); const second = cache.watch(request, '/two', () => {}, 0); second();
  } finally { stop(); cache.close(); }
});

test('unchanged reconciliation preserves form data identity while changed fields and hostile JSON keys remain correct', async () => {
  const cache = new ResourceCache(); let reads = 0;
  const request = (async () => { reads++; return JSON.parse('{"policy":{"days":7},"count":' +
    (reads < 3 ? 1 : 2) + ',"__proto__":{"polluted":true}}'); }) as ResourceRequest;
  let current: ResourceSnapshot<any> | undefined;
  const stop = cache.watch(request, '/log-retention', value => { current = value; }, 0);
  try {
    await until(() => current?.data !== null);
    const first = current!.data;
    cache.mutation('/log-retention'); await until(() => reads === 2 && !current?.loading);
    assert.equal(current!.data, first);
    cache.invalidate(); await until(() => current?.data.count === 2);
    assert.notEqual(current!.data, first);
    assert.equal(current!.data.policy, first.policy);
    assert.equal(Object.getPrototypeOf(current!.data), Object.prototype);
    assert.equal(Object.hasOwn(current!.data, '__proto__'), true);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  } finally { stop(); cache.close(); }
});

test('task presentation distinguishes queue, cancellation, cleanup and uncertain restart outcomes', () => {
  const base: JobView = { status: 'running', startedAt: new Date().toISOString(), log: '' };
  assert.equal(jobPresentation({ ...base, admission: 'queued' }).label, '等待资源');
  assert.equal(jobPresentation({ ...base, admission: 'cancelling' }).label, '正在取消');
  assert.equal(jobPresentation({ ...base, status: 'error', admission: 'cleanup-pending' }).retryable, false);
  assert.equal(jobPresentation({ ...base, status: 'error', admission: 'cleanup-pending', cleanupResolvedAt: 'confirmed' }).retryable, true);
  assert.equal(jobPresentation({ ...base, status: 'interrupted' }).label, '待核对');
});
