/**
 * 模块职责：回归验证模块，围绕 `metadata-store` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `metadata-store`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: damaged recovery index starts read-only and explicit rebuild preserves original bytes and domain authority; recovery read and write byte limits agree; capacity never replaces the last readable index.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { RecoveryCatalog, RECOVERY_LIMITS, type RecoveryCandidate } from '../server/recovery-catalog.ts';
import { HostRuntime } from '../server/host-runtime/governor.ts';
import { MetadataStore, metadataKey } from '../server/metadata-store.ts';
import { readCommittedStore, readStore, writeStore } from '../server/local-store.ts';
import { metadataQueueLimits, metadataQueueSnapshot, serializedMetadata } from '../server/metadata-queue.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: damaged recovery index starts read-only and explicit rebuild preserves original bytes and domain authority
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `runtime.acquire`, `lease.cleanupPending`.
 * 检查边界 / Checked boundaries: `assert.equal(catalog.diagnostics().state, 'degraded')`; `assert.equal(catalog.view()[0].available, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('damaged recovery index starts read-only and explicit rebuild preserves original bytes and domain authority', async (t) => {
  const { root, file } = await fixture(t);
  await writeFile(file, '{corrupt recovery index');
  let recoveries = 0, confirmations = 0;
  const runtime = new HostRuntime({ budgets: { execution: { capacity: 1 } } });
  const lease = await runtime.acquire({ owner: 'source', kind: 'migration', label: 'original-transfer', cost: { execution: 1 } });
  lease.cleanupPending(new Error('original process exit unconfirmed'));
  t.after(() => { lease.release(); runtime.close(); });
  const catalog = new RecoveryCatalog(file, () => runtime.snapshot().resources);
  const candidate: RecoveryCandidate = { binding: { domain: 'migration', ticketId: 'original-transfer', owner: 'source' },
    resourceIds: [lease.id], actions: [{ id: 'verify', title: 'verify original transfer' }] };
  catalog.register({ id: 'migration', /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回列表形式的受控数据，供调用者遍历或比较。
   * Result: Return controlled data as a list for iteration or comparison.
   * 验证场景 / Scenario: damaged recovery index starts read-only and explicit rebuild preserves original bytes and domain authority
   */
  discover: () => [candidate], /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: damaged recovery index starts read-only and explicit rebuild preserves original bytes and domain authority
   */
  recover: async () => { recoveries++; },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回布尔判定，供用例选择路径或核对受控条件。
     * Result: Return a boolean decision for path selection or controlled-condition assertions.
     * 验证场景 / Scenario: damaged recovery index starts read-only and explicit rebuild preserves original bytes and domain authority
     */
    confirmed: () => { confirmations++; return true; } });
  await catalog.init();
  assert.equal(catalog.diagnostics().state, 'degraded');
  assert.equal(catalog.view()[0].available, false);
  const record = catalog.view()[0];
  await assert.rejects(catalog.retry({ id: record.id, digest: record.digest, action: 'verify' }), { code: 'RECOVERY_DEGRADED' });
  await assert.rejects(catalog.rebuild({ revision: '0'.repeat(64) }), { code: 'RECOVERY_STALE' });
  const rebuilt = await catalog.rebuild({ revision: catalog.diagnostics().revision });
  assert.equal(await readFile(join(root, rebuilt.diagnostics!.quarantineFile!), 'utf8'), '{corrupt recovery index');
  assert.equal(rebuilt.records[0].state, 'pending');
  assert.equal(recoveries, 0); assert.equal(confirmations, 0);
  assert.equal(runtime.snapshot().budgets[0].used, 1);
  const reloaded = new RecoveryCatalog(file, () => runtime.snapshot().resources);
  await reloaded.init();
  assert.equal(reloaded.diagnostics().state, 'healthy');
  assert.equal(reloaded.view()[0].state, 'pending');
  await catalog.close(); await reloaded.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: recovery read and write byte limits agree; capacity never replaces the last readable index
 * 状态影响 / State effects: `many`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `catalog.register`, `catalog.init`, `readFile`.
 * 检查边界 / Checked boundaries: `assert.equal(catalog.diagnostics().code, 'RECOVERY_CAPACITY')`; `assert.deepEqual(await readFile(file), original)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('recovery read and write byte limits agree; capacity never replaces the last readable index', async (t) => {
  const { file } = await fixture(t);
  const catalog = new RecoveryCatalog(file, () => []);
  let many = false;
  /**
   * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
   * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
   * 输入 / Inputs: index: number。
   * 结果：返回分支计算值（`({ binding: { domain: 'capacity', ticketId: String(index), owner: 'test' }, reso…`）。
   * Result: Return the branch-computed value (`({ binding: { domain: 'capacity', ticketId: String(index), owner: 'test' }, reso…`).
   * 验证场景 / Scenario: recovery read and write byte limits agree; capacity never replaces the last readable index
   * 协作入口 / Collaborators: `String`, `Array.from`.
   */
  const ticket = (index: number): RecoveryCandidate => ({ binding: { domain: 'capacity', ticketId: String(index), owner: 'test' },
    resourceIds: Array.from({ length: 32 }, (_, resource) => `${resource}-${'界'.repeat(60)}`), actions: [] });
  catalog.register({ id: 'capacity', /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`many ? Array.from({ length: 4096 }, (_, index) => ticket(index)) : [ticket(0)]`）。
   * Result: Return the branch-computed value (`many ? Array.from({ length: 4096 }, (_, index) => ticket(index)) : [ticket(0)]`).
   * 验证场景 / Scenario: recovery read and write byte limits agree; capacity never replaces the last readable index
   * 协作入口 / Collaborators: `Array.from`, `ticket`.
   */
  discover: () => many ? Array.from({ length: 4096 }, (_, index) => ticket(index)) : [ticket(0)] });
  await catalog.init();
  const original = await readFile(file);
  many = true; await catalog.refresh();
  assert.equal(catalog.diagnostics().code, 'RECOVERY_CAPACITY');
  assert.deepEqual(await readFile(file), original);
  assert.ok(original.byteLength <= RECOVERY_LIMITS.maxBytes);
  const reloaded = new RecoveryCatalog(file, () => []);
  await reloaded.init(); assert.equal(reloaded.diagnostics().state, 'healthy');
  assert.equal(reloaded.view().length, 1);
  many = false; await catalog.close(); await reloaded.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: recovery prunes only completed history, refuses incomplete discovery, and retains an unwritable path
 * 状态影响 / State effects: `unavailable`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `Array.from`, `writeStore`, `checksum`.
 * 检查边界 / Checked boundaries: `assert.equal(catalog.view().filter(record => record.state === 'resolved').length, RECOVERY_LIMITS.resolvedRetention)`; `assert.equal(catalog.view().filter(record => record.state === 'pending').length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('recovery prunes only completed history, refuses incomplete discovery, and retains an unwritable path', async (t) => {
  const { root, file } = await fixture(t);
  /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: value: unknown。
   * 结果：返回分支计算值（`createHash('sha256').update(JSON.stringify(value)).digest('hex')`）。
   * Result: Return the branch-computed value (`createHash('sha256').update(JSON.stringify(value)).digest('hex')`).
   * 验证场景 / Scenario: recovery prunes only completed history, refuses incomplete discovery, and retains an unwritable path
   * 协作入口 / Collaborators: `createHash('sha256').update(JSON.stringify(value)).digest`, `createHash('sha256').update`, `createHash`, `JSON.stringify`.
   */
  const checksum = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const records = Array.from({ length: 300 }, (_, index) => {
    const binding = { domain: 'retention', ticketId: String(index), owner: 'test' };
    return { id: checksum(binding), binding, resourceIds: [], state: index === 0 ? 'pending' : 'resolved',
      firstSeenAt: new Date(0).toISOString(), updatedAt: new Date(index).toISOString(), attempts: 0 };
  });
  await writeStore(file, { version: 1, records, digest: checksum(records) });
  const catalog = new RecoveryCatalog(file, () => []);
  await catalog.init();
  assert.equal(catalog.view().filter(record => record.state === 'resolved').length, RECOVERY_LIMITS.resolvedRetention);
  assert.equal(catalog.view().filter(record => record.state === 'pending').length, 1);
  const before = await readFile(file);
  let unavailable = true;
  catalog.register({ id: 'unavailable', /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：返回列表形式的受控数据，供调用者遍历或比较。
   * Result: Return controlled data as a list for iteration or comparison.
   * 验证场景 / Scenario: recovery prunes only completed history, refuses incomplete discovery, and retains an unwritable path
   * 失败 / Failure: `new Error('source unavailable')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  discover: () => { if (unavailable) throw new Error('source unavailable'); return []; } });
  await catalog.refresh(); assert.equal(catalog.diagnostics().state, 'degraded');
  await assert.rejects(catalog.rebuild({ revision: catalog.diagnostics().revision }), { code: 'RECOVERY_SOURCE_UNAVAILABLE' });
  assert.deepEqual(await readFile(file), before);
  unavailable = false; await catalog.close();
  const blocked = join(root, 'not-a-file'); await mkdir(blocked);
  const invalid = new RecoveryCatalog(blocked, () => []); await invalid.init();
  assert.equal(invalid.diagnostics().state, 'degraded');
  await assert.rejects(invalid.rebuild({ revision: invalid.diagnostics().revision }), { code: 'RECOVERY_CORRUPT' });
  assert.deepEqual(await readdir(blocked), []); await invalid.close();
  const blockedParent = join(root, 'parent-is-a-file'); await writeFile(blockedParent, 'keep this file');
  const unwritable = new RecoveryCatalog(join(blockedParent, 'recovery.json'), () => []);
  await unwritable.init();
  assert.equal(unwritable.diagnostics().state, 'degraded');
  await assert.rejects(unwritable.rebuild({ revision: unwritable.diagnostics().revision }));
  assert.equal(await readFile(blockedParent, 'utf8'), 'keep this file');
  await unwritable.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy writers and readers share the transaction queue; committed reads never wait for it
 * 状态影响 / State effects: `snapshot.count`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `store.replace`, `store.update`, `writeStore`.
 * 检查边界 / Checked boundaries: `assert.equal((await readCommittedStore(file, () => ({ count: 0 }))).count, 1)`; `assert.equal(metadataQueueSnapshot().pending, 3)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('legacy writers and readers share the transaction queue; committed reads never wait for it', async (t) => {
  const { root, file, store } = await fixture(t);
  await store.replace({ count: 1, entries: [] });
  let enter!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, finish!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const entered = new Promise<void>((done) => {
    enter = done;
  });
  const gate = new Promise<void>((done) => {
    finish = done;
  });
  const edit = store.update(async (value) => {
    value.count = 2;
    enter();
    await gate;
  });
  await entered;
  const snapshot = { count: 3, entries: ['captured'] };
  const legacy = writeStore(join(root, 'unused', '..', 'state.json'), snapshot);
  snapshot.count = 999;
  const read = readStore(file, () => ({ count: 0, entries: [] }));
  assert.equal((await readCommittedStore(file, () => ({ count: 0 }))).count, 1);
  assert.equal(metadataQueueSnapshot().pending, 3);
  finish();
  await Promise.all([edit, legacy]);
  assert.deepEqual(await read, { count: 3, entries: ['captured'] });
  assert.equal((await store.read()).value.count, 3);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: per-file admission is bounded and overflow cannot cancel or reorder admitted publications
 * 协作入口 / Collaborators: `fixture`, `store.update`, `Array.from`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(writeStore(file, { count: 999, entries: [] }), { code: 'METADATA_QUEUE_FULL' })`; `assert.equal(snapshot.pending, metadataQueueLimits.perFile)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('per-file admission is bounded and overflow cannot cancel or reorder admitted publications', async (t) => {
  const { file, store } = await fixture(t);
  let finish!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const gate = new Promise<void>((done) => {
    finish = done;
  });
  const first = store.update(async (value) => {
    await gate;
    value.count++;
  });
  const rest = Array.from({ length: metadataQueueLimits.perFile - 1 }, () =>
    store.update((value) => {
      value.count++;
    }),
  );
  await assert.rejects(writeStore(file, { count: 999, entries: [] }), { code: 'METADATA_QUEUE_FULL' });
  const snapshot = metadataQueueSnapshot();
  assert.equal(snapshot.pending, metadataQueueLimits.perFile);
  assert.ok(snapshot.files.every((entry) => !('value' in entry) && /^[a-f0-9]{64}$/.test(entry.key)));
  finish();
  await Promise.all([first, ...rest]);
  await store.flush();
  assert.equal((await store.read()).value.count, metadataQueueLimits.perFile);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: commit-guard and revision refusals preserve bytes and do not leave an unconfirmed write
 * 协作入口 / Collaborators: `fixture`, `store.replace`, `assert.rejects`, `store.flush`.
 * 检查边界 / Checked boundaries: `assert.rejects( store.replace( { count: 2, entries: [] }, { beforeCommit: () => { throw new Error('approval revoked'); }, }, ), /a…`; `assert.rejects(store.replace({ count: 3, entries: [] }, { expectedRevision: 'stale' }), { code: 'METADATA_REVISION_CONFLICT', })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('commit-guard and revision refusals preserve bytes and do not leave an unconfirmed write', async (t) => {
  const { root, file, store } = await fixture(t);
  const saved = await store.replace({ count: 1, entries: [] });
  await assert.rejects(
    store.replace(
      { count: 2, entries: [] },
      {
        /**
         * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
         * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: commit-guard and revision refusals preserve bytes and do not leave an unconfirmed write
         * 失败 / Failure: `new Error('approval revoked')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         */
        beforeCommit: () => {
          throw new Error('approval revoked');
        },
      },
    ),
    /approval revoked/,
  );
  await store.flush();
  await assert.rejects(store.replace({ count: 3, entries: [] }, { expectedRevision: 'stale' }), {
    code: 'METADATA_REVISION_CONFLICT',
  });
  await store.flush();
  assert.deepEqual(await store.read(), saved);
  assert.deepEqual(await readdir(root), ['state.json']);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).count, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: global metadata admission counts running and queued work across files until actual settlement
 * 协作入口 / Collaborators: `fixture`, `Array.from`, `assert.rejects`, `serializedMetadata`.
 * 检查边界 / Checked boundaries: `assert.rejects( serializedMetadata(join(root, 'overflow.json'), false, async () => {}), { code: 'METADATA_QUEUE_FULL', }, )`; `assert.equal(metadataQueueSnapshot().pending, metadataQueueLimits.pending)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('global metadata admission counts running and queued work across files until actual settlement', async (t) => {
  const { root } = await fixture(t);
  let finish!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const gate = new Promise<void>((done) => {
    finish = done;
  });
  const work = Array.from({ length: metadataQueueLimits.pending }, (_, index) =>
    serializedMetadata(
      join(root, `${Math.floor(index / metadataQueueLimits.perFile)}.json`),
      false,
      () => gate,
    ),
  );
  await assert.rejects(
    serializedMetadata(join(root, 'overflow.json'), false, async () => {}),
    {
      code: 'METADATA_QUEUE_FULL',
    },
  );
  assert.equal(metadataQueueSnapshot().pending, metadataQueueLimits.pending);
  finish();
  await Promise.all(work);
  await serializedMetadata(join(root, 'overflow.json'), false, async () => {});
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a fresh process resumes the same JSON revision and commits without sidecars or queue state
 * 协作入口 / Collaborators: `fixture`, `store.replace`, `promisify(execFile)`, `promisify`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(JSON.parse(stdout), saved)`; `assert.deepEqual((await store.read()).value, { count: 6, entries: ['before-restart', 'after-restart'] })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a fresh process resumes the same JSON revision and commits without sidecars or queue state', async (t) => {
  const { root, file, store } = await fixture(t);
  const saved = await store.replace({ count: 5, entries: ['before-restart'] });
  const script = `const { MetadataStore } = await import(process.argv[1]);
const store = new MetadataStore(process.argv[2], { fallback: () => ({ count: 0, entries: [] }) });
const before = await store.read();
await store.update(value => { value.count++; value.entries.push('after-restart'); }, { expectedRevision: before.revision });
await store.flush(); process.stdout.write(JSON.stringify(before));`;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      script,
      new URL('../server/metadata-store.ts', import.meta.url).href,
      file,
    ],
    { windowsHide: true },
  );
  assert.deepEqual(JSON.parse(stdout), saved);
  assert.deepEqual((await store.read()).value, { count: 6, entries: ['before-restart', 'after-restart'] });
  assert.deepEqual(await readdir(root), ['state.json']);
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: { after: (fn: () => Promise<void>) => void }。
 * 结果：返回受控对象，公开字段包括 `root, file, store`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `root, file, store`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 */
async function fixture(t: { after: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: fn: () => Promise<void>。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(fn: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'sakura-metadata-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  });
  const file = join(root, 'state.json');
  const store = new MetadataStore(file, { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ count: 0, entries: [] as string[] })`）。
   * Result: Return the branch-computed value (`({ count: 0, entries: [] as string[] })`).
   */
  fallback: () => ({ count: 0, entries: [] as string[] }) });
  return { root, file, store };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: metadata writers share normalized keys and serialize complete read-modify-write transactions
 * 协作入口 / Collaborators: `fixture`, `join`, `Promise.all`, `Array.from`.
 * 检查边界 / Checked boundaries: `assert.equal(result.value.count, 40)`; `assert.equal(new Set(result.value.entries).size, 40)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('metadata writers share normalized keys and serialize complete read-modify-write transactions', async (t) => {
  const { root, file, store } = await fixture(t);
  const alias = new MetadataStore(join(root, 'unused', '..', 'state.json'), {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ count: 0, entries: [] as string[] })`）。
     * Result: Return the branch-computed value (`({ count: 0, entries: [] as string[] })`).
     * 验证场景 / Scenario: metadata writers share normalized keys and serialize complete read-modify-write transactions
     */
    fallback: () => ({ count: 0, entries: [] as string[] }),
  });
  await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      (index % 2 ? store : alias).update(async (value) => {
        const before = value.count;
        await Promise.resolve();
        value.count = before + 1;
        value.entries.push(String(index));
      }),
    ),
  );
  await store.flush();
  const result = await store.read();
  assert.equal(result.value.count, 40);
  assert.equal(new Set(result.value.entries).size, 40);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), result.value, 'No JSON envelope is introduced');
  if (process.platform === 'win32') assert.equal(metadataKey(file), metadataKey(file.toUpperCase()));
  assert.deepEqual(await readdir(root), ['state.json']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: replace captures at admission while unrelated files continue to publish
 * 状态影响 / State effects: `value.count`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `store.update`, `store.replace`, `value.entries.push`.
 * 检查边界 / Checked boundaries: `assert.equal((await independent.read()).value, 1)`; `assert.deepEqual((await store.read()).value, { count: 7, entries: ['captured'] })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('replace captures at admission while unrelated files continue to publish', async (t) => {
  const { root, store } = await fixture(t);
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, finish!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const ready = new Promise<void>((done) => {
    entered = done;
  });
  const gate = new Promise<void>((done) => {
    finish = done;
  });
  const first = store.update(async () => {
    entered();
    await gate;
  });
  await ready;
  const value = { count: 7, entries: ['captured'] };
  const replacement = store.replace(value);
  value.count = 999;
  value.entries.push('later');
  const independent = new MetadataStore(join(root, 'other.json'), { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`0`）。
   * Result: Return the branch-computed value (`0`).
   * 验证场景 / Scenario: replace captures at admission while unrelated files continue to publish
   */
  fallback: () => 0 });
  await independent.replace(1);
  assert.equal((await independent.read()).value, 1);
  finish();
  await first;
  await replacement;
  assert.deepEqual((await store.read()).value, { count: 7, entries: ['captured'] });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: content revisions survive reopening and refuse stale or externally changed publications
 * 协作入口 / Collaborators: `fixture`, `store.read`, `assert.equal`, `store.replace`.
 * 检查边界 / Checked boundaries: `assert.equal(missing.revision, 'missing')`; `assert.equal((await reopened.read()).revision, initial.revision)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('content revisions survive reopening and refuse stale or externally changed publications', async (t) => {
  const { file, store } = await fixture(t);
  const missing = await store.read();
  assert.equal(missing.revision, 'missing');
  const initial = await store.replace({ count: 1, entries: [] }, { expectedRevision: missing.revision });
  const reopened = new MetadataStore(file, { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ count: 0, entries: [] as string[] })`）。
   * Result: Return the branch-computed value (`({ count: 0, entries: [] as string[] })`).
   * 验证场景 / Scenario: content revisions survive reopening and refuse stale or externally changed publications
   */
  fallback: () => ({ count: 0, entries: [] as string[] }) });
  assert.equal((await reopened.read()).revision, initial.revision);
  await reopened.update(
    (value) => {
      value.count++;
    },
    { expectedRevision: initial.revision },
  );
  await assert.rejects(store.replace({ count: 9, entries: [] }, { expectedRevision: initial.revision }), {
    code: 'METADATA_REVISION_CONFLICT',
  });
  assert.equal((await store.read()).value.count, 2);
  const before = await store.read();
  await writeFile(file, '{"count":3,"entries":[]}');
  await assert.rejects(
    store.update(
      (value) => {
        value.count++;
      },
      { expectedRevision: before.revision },
    ),
    { code: 'METADATA_REVISION_CONFLICT' },
  );
  await store.update((value) => {
    value.count++;
  });
  await store.flush();
  assert.equal((await store.read()).value.count, 4);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: refused edits do not taint flush; physical publication failures remain visible and retryable
 * 协作入口 / Collaborators: `fixture`, `store.replace`, `assert.rejects`, `store.update`.
 * 检查边界 / Checked boundaries: `assert.rejects( store.update((value) => { value.count = 90; throw new Error('edit refused'); }), /edit refused/, )`; `assert.equal((await store.read()).value.count, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('refused edits do not taint flush; physical publication failures remain visible and retryable', async (t) => {
  const { root, store } = await fixture(t);
  await store.replace({ count: 1, entries: [] });
  await assert.rejects(
    store.update((value) => {
      value.count = 90;
      throw new Error('edit refused');
    }),
    /edit refused/,
  );
  assert.equal((await store.read()).value.count, 1);
  await store.flush();
  await store.update((value) => {
    value.count++;
  });
  await store.flush();
  const target = join(root, 'blocked.json');
  await mkdir(target);
  const blocked = new MetadataStore(target, { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`0`）。
   * Result: Return the branch-computed value (`0`).
   * 验证场景 / Scenario: refused edits do not taint flush; physical publication failures remain visible and retryable
   */
  fallback: () => 0 });
  await assert.rejects(blocked.replace(1));
  await assert.rejects(blocked.flush());
  assert.ok(!(await readdir(root)).some((file) => file.endsWith('.tmp')));
  await rm(target, { recursive: true });
  await blocked.replace(2);
  await blocked.flush();
  assert.equal((await blocked.read()).value, 2);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: queued cancellation and invalid JSON never silently publish fallback state
 * 协作入口 / Collaborators: `fixture`, `store.update`, `store.replace`, `abort.abort`.
 * 检查边界 / Checked boundaries: `assert.rejects(cancelled, /cancelled before publication/)`; `assert.equal((await store.read()).value.count, 5)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('queued cancellation and invalid JSON never silently publish fallback state', async (t) => {
  const { file, store } = await fixture(t);
  const abort = new AbortController();
  let finish!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const gate = new Promise<void>((done) => {
    finish = done;
  });
  const first = store.update(async (value) => {
    await gate;
    value.count = 5;
  });
  const cancelled = store.replace({ count: 9, entries: [] }, { signal: abort.signal });
  abort.abort(new Error('cancelled before publication'));
  finish();
  await first;
  await assert.rejects(cancelled, /cancelled before publication/);
  assert.equal((await store.read()).value.count, 5);
  await writeFile(file, '{damaged');
  await assert.rejects(store.read(), SyntaxError);
  await assert.rejects(
    store.update((value) => {
      value.count++;
    }),
    SyntaxError,
  );
  assert.equal(await readFile(file, 'utf8'), '{damaged');
  await store.replace({ count: 6, entries: [] });
  await store.flush();
});
