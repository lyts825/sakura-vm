import assert from 'node:assert/strict';
import test from 'node:test';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { StorageRuntime, type StorageLease, type StorageRequest } from '../server/storage-runtime.ts';

const request = (taskId: string, extra: Partial<StorageRequest> = {}): StorageRequest => ({
  owner: 'test:storage',
  taskId,
  label: taskId,
  paths: ['/disk/a'],
  mode: 'read',
  buffers: 8,
  files: 2,
  ...extra,
});
const device = async (path: string) => ({
  key: path.startsWith('/other') ? 'other' : 'disk',
  path,
  freeBytes: 1000,
  totalBytes: 1000,
});
const governor = () =>
  new HostRuntime({
    budgets: { io: { capacity: 4 }, 'io.buffers': { capacity: 100 }, 'io.files': { capacity: 20 } },
  });
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const used = (host: HostRuntime, key: string) =>
  host.snapshot().budgets.find((value) => value.key === key || value.key === 'partition:' + key)?.used || 0;

test('storage admission atomically limits a device and task while independent devices continue', async () => {
  const host = governor(),
    runtime = new StorageRuntime(host, device);
  const first = await runtime.acquire(request('first', { mode: 'write' }));
  const cancel = new AbortController();
  const waiting = runtime.acquire(request('second', { mode: 'write', signal: cancel.signal }));
  await turn();
  assert.equal(host.snapshot().queued, 1);
  assert.equal(used(host, 'io'), 1, 'A queued writer holds no partial host budget');
  const independent = await runtime.acquire(request('other', { paths: ['/other/a'], mode: 'write' }));
  const sameTask = runtime.acquire(request('first', { paths: ['/other/b'], signal: cancel.signal }));
  await turn();
  assert.equal(host.snapshot().queued, 2);
  cancel.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  await assert.rejects(sameTask, { name: 'AbortError' });
  first.release();
  independent.release();
  assert.equal(used(host, 'io'), 0);
  host.close();
});

test('device aliases share temporary reservations and sequential stages charge their peak', async () => {
  const host = governor();
  const runtime = new StorageRuntime(host, async (path) => ({ ...(await device(path)), freeBytes: 100 }));
  const sibling = new StorageRuntime(host, async (path) => ({ ...(await device(path)), freeBytes: 100 }));
  const held = await runtime.acquire(
    request('peak', {
      temporaryPhases: [
        [
          { path: '/disk/a', bytes: 30 },
          { path: '/disk/alias', bytes: 30 },
        ],
        [{ path: '/disk/later', bytes: 20 }],
      ],
    }),
  );
  assert.equal(used(host, 'storage.temporary:disk'), 60);
  await assert.rejects(
    sibling.acquire(request('overbook', { temporary: [{ path: '/disk/alias', bytes: 41 }] })),
    { code: 'STORAGE_SPACE_REQUIRED' },
  );
  assert.equal(used(host, 'io'), 1);
  held.release();
  const retry = await sibling.acquire(request('retry', { temporary: [{ path: '/disk/alias', bytes: 100 }] }));
  retry.release();
  host.close();
});

test('temporary free-space recheck detects device replacement and releases every acquired dimension', async () => {
  const host = governor();
  let calls = 0;
  const runtime = new StorageRuntime(host, async (path) => ({
    ...(await device(path)),
    key: ++calls === 1 ? 'old' : 'new',
  }));
  await assert.rejects(runtime.acquire(request('replaced', { temporary: [{ path: '/disk/a', bytes: 1 }] })), {
    code: 'STORAGE_DEVICE_CHANGED',
  });
  assert.equal(used(host, 'io'), 0);
  assert.equal(host.snapshot().resources.length, 0);
  host.close();
});

test('verification failures release after successful cleanup, unconfirmed cleanup retains its lease', async () => {
  const host = governor(),
    runtime = new StorageRuntime(host, device);
  const error = new Error('hash mismatch');
  let cleaned = false;
  await assert.rejects(
    runtime.run(request('verification'), async () => {
      try {
        throw error;
      } finally {
        await turn();
        cleaned = true;
      }
    }),
    (value) => value === error,
  );
  assert.equal(cleaned, true);
  assert.equal(used(host, 'io'), 0);
  let held!: StorageLease;
  await assert.rejects(
    runtime.run(request('cleanup', { temporary: [{ path: '/disk/a', bytes: 20 }] }), async (lease) => {
      held = lease;
      lease.cleanupPending(new Error('sharing violation'));
      throw error;
    }),
    { code: 'STORAGE_CLEANUP_PENDING' },
  );
  assert.equal(used(host, 'io'), 1);
  assert.equal(used(host, 'storage.temporary:disk'), 20);
  assert.equal(host.snapshot().resources[0].state, 'cleanup-pending');
  assert.throws(() => held.assertActive(), { code: 'STORAGE_LEASE_REVOKED' });
  held.release();
  held.release();
  assert.equal(used(host, 'io'), 0);
  host.close();
});

test('a late admission result after scope cancellation cannot start disk side effects', async () => {
  const host = governor(),
    abort = new AbortController();
  let mutations = 0;
  const delayed = {
    acquire: async (input: Parameters<HostRuntime['acquire']>[0]) => {
      const lease = await host.acquire(input);
      abort.abort();
      return lease;
    },
  };
  const runtime = new StorageRuntime(delayed, device);
  await assert.rejects(
    runtime.run(request('late', { signal: abort.signal }), async () => {
      mutations++;
    }),
    { name: 'AbortError' },
  );
  assert.equal(mutations, 0);
  assert.equal(used(host, 'io'), 0);
  host.close();
});

test('buffer and file budgets reject impossible declarations without filesystem work', async () => {
  const host = governor(),
    runtime = new StorageRuntime(host, device);
  let mutations = 0;
  await assert.rejects(
    runtime.run(request('oversize', { buffers: 101 }), async () => {
      mutations++;
    }),
  );
  assert.equal(mutations, 0);
  assert.equal(used(host, 'io'), 0);
  host.close();
});
