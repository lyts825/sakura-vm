/**
 * 模块职责：回归验证模块，围绕 `storage-runtime` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `storage-runtime`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: storage admission atomically limits a device and task while independent devices continue; device aliases share temporary reservations and sequential stages charge their peak.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { StorageRuntime, type StorageLease, type StorageRequest } from '../server/storage-runtime.ts';

/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: taskId: string; extra: Partial<StorageRequest> = {}。
 * 结果：返回分支计算值（`({ owner: 'test:storage', taskId, label: taskId, paths: ['/disk/a'], mode: 'read…`）。
 * Result: Return the branch-computed value (`({ owner: 'test:storage', taskId, label: taskId, paths: ['/disk/a'], mode: 'read…`).
 */
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
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: path: string。
 * 结果：返回分支计算值（`({ key: path.startsWith('/other') ? 'other' : 'disk', path, freeBytes: 1000, tot…`），以 Promise 交付。
 * Result: Return the branch-computed value (`({ key: path.startsWith('/other') ? 'other' : 'disk', path, freeBytes: 1000, tot…`) through a Promise.
 * 协作入口 / Collaborators: `path.startsWith`.
 */
const device = async (path: string) => ({
  key: path.startsWith('/other') ? 'other' : 'disk',
  path,
  freeBytes: 1000,
  totalBytes: 1000,
});
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`new HostRuntime({ budgets: { io: { capacity: 4 }, 'io.buffers': { capacity: 100 …`）。
 * Result: Return the branch-computed value (`new HostRuntime({ budgets: { io: { capacity: 4 }, 'io.buffers': { capacity: 100 …`).
 */
const governor = () =>
  new HostRuntime({
    budgets: { io: { capacity: 4 }, 'io.buffers': { capacity: 100 }, 'io.files': { capacity: 20 } },
  });
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`new Promise<void>((resolve) => setImmediate(resolve))`）。
 * Result: Return the branch-computed value (`new Promise<void>((resolve) => setImmediate(resolve))`).
 */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: host: HostRuntime; key: string。
 * 结果：返回分支计算值（`host.snapshot().budgets.find((value) => value.key === key || value.key === 'part…`）。
 * Result: Return the branch-computed value (`host.snapshot().budgets.find((value) => value.key === key || value.key === 'part…`).
 * 协作入口 / Collaborators: `host.snapshot().budgets.find`, `host.snapshot`.
 */
const used = (host: HostRuntime, key: string) =>
  host.snapshot().budgets.find((value) => value.key === key || value.key === 'partition:' + key)?.used || 0;

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: storage admission atomically limits a device and task while independent devices continue
 * 协作入口 / Collaborators: `governor`, `runtime.acquire`, `request`, `turn`.
 * 检查边界 / Checked boundaries: `assert.equal(host.snapshot().queued, 1)`; `assert.equal(used(host, 'io'), 1, 'A queued writer holds no partial host budget')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: device aliases share temporary reservations and sequential stages charge their peak
 * 协作入口 / Collaborators: `governor`, `runtime.acquire`, `request`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(used(host, 'storage.temporary:disk'), 60)`; `assert.rejects( sibling.acquire(request('overbook', { temporary: [{ path: '/disk/alias', bytes: 41 }] })), { code: 'STORAGE_SPACE_…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: temporary free-space recheck detects device replacement and releases every acquired dimension
 * 协作入口 / Collaborators: `governor`, `assert.rejects`, `runtime.acquire`, `request`.
 * 检查边界 / Checked boundaries: `assert.rejects(runtime.acquire(request('replaced', { temporary: [{ path: '/disk/a', bytes: 1 }] })), { code: 'STORAGE_DEVICE_CHANG…`; `assert.equal(used(host, 'io'), 0)`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: verification failures release after successful cleanup, unconfirmed cleanup retains its lease
 * 协作入口 / Collaborators: `governor`, `assert.rejects`, `runtime.run`, `request`.
 * 检查边界 / Checked boundaries: `assert.rejects( runtime.run(request('verification'), async () => { try { throw error; } finally { await turn(); cleaned = true; } …`; `assert.equal(cleaned, true)`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a late admission result after scope cancellation cannot start disk side effects
 * 协作入口 / Collaborators: `governor`, `assert.rejects`, `runtime.run`, `request`.
 * 检查边界 / Checked boundaries: `assert.rejects( runtime.run(request('late', { signal: abort.signal }), async () => { mutations++; }), { name: 'AbortError' }, )`; `assert.equal(mutations, 0)`.
 */
test('a late admission result after scope cancellation cannot start disk side effects', async () => {
  const host = governor(),
    abort = new AbortController();
  let mutations = 0;
  const delayed = {
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: input: Parameters<HostRuntime['acquire']>[0]。
     * 结果：返回分支计算值（`lease`），以 Promise 交付。
     * Result: Return the branch-computed value (`lease`) through a Promise.
     * 验证场景 / Scenario: a late admission result after scope cancellation cannot start disk side effects
     * 协作入口 / Collaborators: `host.acquire`, `abort.abort`.
     */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: buffer and file budgets reject impossible declarations without filesystem work
 * 协作入口 / Collaborators: `governor`, `assert.rejects`, `runtime.run`, `request`.
 * 检查边界 / Checked boundaries: `assert.rejects( runtime.run(request('oversize', { buffers: 101 }), async () => { mutations++; }), )`; `assert.equal(mutations, 0)`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: incremental reservations count materialized bytes once and reject before writing past free space
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `governor`.
 * 检查边界 / Checked boundaries: `assert.equal(used(host, 'storage.temporary:disk'), 90)`; `assert.rejects(lease.reserveTemporary(file, 101), { code: 'STORAGE_SPACE_REQUIRED' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('incremental reservations count materialized bytes once and reject before writing past free space', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-growth-')),
    file = join(root, 'part');
  const host = governor();
  const runtime = new StorageRuntime(host, async (path) => ({
    key: 'disk',
    path,
    totalBytes: 100,
    freeBytes: 100 - (await stat(file).catch(() => ({ size: 0 }))).size,
  }));
  const abort = new AbortController();
  const lease = await runtime.acquire(
    request('growth', { paths: [file], dynamicTemporary: [file], signal: abort.signal }),
  );
  try {
    await lease.reserveTemporary(file, 60);
    await writeFile(file, Buffer.alloc(60));
    await lease.reserveTemporary(file, 90);
    await writeFile(file, Buffer.alloc(90));
    assert.equal(used(host, 'storage.temporary:disk'), 90);
    await assert.rejects(lease.reserveTemporary(file, 101), { code: 'STORAGE_SPACE_REQUIRED' });
    assert.equal((await stat(file)).size, 90, 'Denied growth must not reach the writer');
    assert.equal(used(host, 'storage.temporary:disk'), 90, 'A failed growth keeps the prior reservation');
    abort.abort();
    await assert.rejects(lease.reserveTemporary(file, 91), { name: 'AbortError' });
    await rm(file);
    await lease.releaseTemporary(file); // Cleanup is allowed after cancellation.
    assert.equal(used(host, 'storage.temporary:disk'), 1);
  } finally {
    lease.release();
    host.close();
    assert.equal(dirname(root), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: governor resize refusal rolls the storage ledger back across runtime instances
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `governor`.
 * 检查边界 / Checked boundaries: `assert.rejects(lease.reserveTemporary(join(root, 'first'), 90), { code: 'RESOURCE_CAPACITY' })`; `assert.equal(used(host, 'storage.temporary:disk'), 80)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('governor resize refusal rolls the storage ledger back across runtime instances', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-growth-ledger-'));
  const host = governor(),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: path: string。
     * 结果：返回分支计算值（`({ key: 'disk', path, totalBytes: 100, freeBytes: 100 })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ key: 'disk', path, totalBytes: 100, freeBytes: 100 })`) through a Promise.
     * 验证场景 / Scenario: governor resize refusal rolls the storage ledger back across runtime instances
     */
    inspect = async (path: string) => ({ key: 'disk', path, totalBytes: 100, freeBytes: 100 });
  const runtime = new StorageRuntime(host, inspect),
    sibling = new StorageRuntime(host, inspect);
  const lease = await runtime.acquire(request('growth', { paths: [root], dynamicTemporary: [root] }));
  const external = await host.acquire({
    owner: 'test:capacity',
    kind: 'fixture',
    label: 'Other committed allocation',
    cost: {},
    partitions: [{ key: 'storage.temporary:disk', limit: 100, amount: 20 }],
  });
  try {
    await lease.reserveTemporary(join(root, 'first'), 60);
    await assert.rejects(lease.reserveTemporary(join(root, 'first'), 90), { code: 'RESOURCE_CAPACITY' });
    assert.equal(used(host, 'storage.temporary:disk'), 80);
    external.release();
    const second = await sibling.acquire(
      request('second', { paths: [root], temporary: [{ path: root, bytes: 40 }] }),
    );
    second.release(); // Would fail free-space recheck if the rejected growth left 90 in the shared ledger.
    await lease.reserveTemporary(join(root, 'first'), 100);
    assert.equal(used(host, 'storage.temporary:disk'), 100);
  } finally {
    external.release();
    lease.release();
    host.close();
    assert.equal(dirname(root), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});
