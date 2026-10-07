/**
 * 模块职责：回归验证模块，围绕 `cold-migration` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `cold-migration`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: cold migration persists a retry identity and removes only an unchanged source after a remote receipt; a changed source is retained even when the remote copy exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bundles } from '../server/bundles.ts';
import { ColdMigrations } from '../server/cold-migration.ts';
import type { HostPeers } from '../server/host-peers.ts';
import type { Machines, MigrationFingerprint } from '../server/machines.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cold migration persists a retry identity and removes only an unchanged source after a remote receipt
 * 状态影响 / State effects: `stored.entries[0].status`, `eligible`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.equal((await first.preview(vmId, {})).ready, false)`; `assert.match((await first.preview(vmId, { ...options, confirmSourceRemoval: true, startTarget: true })).reason || '', /先完成一次/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cold migration persists a retry identity and removes only an unchanged source after a remote receipt', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-cold-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vmId = randomUUID();
  const peerId = randomUUID();
  const remoteId = randomUUID();
  const remoteVmId = randomUUID();
  const fingerprint: MigrationFingerprint = { recordHash: 'a'.repeat(64),
    diskSize: 1024, diskMtimeMs: 1234 };
  const records = new Map<string, { id: string; cpus: number; memoryMiB: number }>(
    [[vmId, { id: vmId, cpus: 2, memoryMiB: 1024 }]]);
  let deletions = 0;
  const machines = {
    records,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`vm`）。
     * Result: Return the branch-computed value (`vm`).
     * 验证场景 / Scenario: cold migration persists a retry identity and removes only an unchanged source after a remote receipt
     * 失败 / Failure: `new Error('missing')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `records.get`.
     */
    get: (id: string) => {
      const vm = records.get(id);
      if (!vm) throw new Error('missing');
      return vm;
    },
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: cold migration persists a retry identity and removes only an unchanged source after a remote receipt
     */
    requireStopped: () => {},
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ...fingerprint })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ...fingerprint })`) through a Promise.
     * 验证场景 / Scenario: cold migration persists a retry identity and removes only an unchanged source after a remote receipt
     */
    migrationFingerprint: async () => ({ ...fingerprint }),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: id: string; expected: MigrationFingerprint。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: cold migration persists a retry identity and removes only an unchanged source after a remote receipt
     * 状态影响 / State effects: `deletions`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.deepEqual`, `records.delete`.
     * 检查边界 / Checked boundaries: `assert.deepEqual(expected, fingerprint)`.
     */
    delete: async (id: string, expected: MigrationFingerprint) => {
      assert.deepEqual(expected, fingerprint);
      deletions += 1;
      records.delete(id);
    },
  } as unknown as Machines;
  const transfers: string[] = [];
  const digest = 'b'.repeat(64);
  let published = false;
  let eligible = true;
  const peers = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] })`）。
     * Result: Return the branch-computed value (`({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] })`).
     * 验证场景 / Scenario: cold migration persists a retry identity and removes only an unchanged source after a remote receipt
     */
    view: () => ({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ candidates: [{ id: remoteId, source: 'peer', eligible, score: eligible ? 90 :…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ candidates: [{ id: remoteId, source: 'peer', eligible, score: eligible ? 90 :…`) through a Promise.
     * 验证场景 / Scenario: cold migration persists a retry identity and removes only an unchanged source after a remote receipt
     */
    score: async () => ({ candidates: [{ id: remoteId, source: 'peer', eligible,
      score: eligible ? 90 : null, reasons: eligible ? [] : ['容量不足'],
      status: { platform: 'win32', arch: 'x64' } }] }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ platform: 'win32', arch: 'x64' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ platform: 'win32', arch: 'x64' })`) through a Promise.
     * 验证场景 / Scenario: cold migration persists a retry identity and removes only an unchanged source after a remote receipt
     */
    status: async () => ({ platform: 'win32', arch: 'x64' }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _peer: string; transferId: string。
     * 结果：返回受控对象，公开字段包括 `id, name, sha256`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `id, name, sha256`; the actual branch determines its shape.
     * 验证场景 / Scenario: cold migration persists a retry identity and removes only an unchanged source after a remote receipt
     * 状态影响 / State effects: `published`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `transfers.push`.
     */
    upload: async (_peer: string, transferId: string) => {
      transfers.push(transferId);
      published = true;
      return { id: remoteVmId, name: 'migrated', sha256: digest };
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`published ? { id: remoteVmId, name: 'migrated', sha256: digest } : null`），以 Promise 交付。
     * Result: Return the branch-computed value (`published ? { id: remoteVmId, name: 'migrated', sha256: digest } : null`) through a Promise.
     * 验证场景 / Scenario: cold migration persists a retry identity and removes only an unchanged source after a remote receipt
     */
    importStatus: async () => published
      ? { id: remoteVmId, name: 'migrated', sha256: digest } : null,
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ready: true, id: remoteVmId, status: 'stopped' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ready: true, id: remoteVmId, status: 'stopped' })`) through a Promise.
     * 验证场景 / Scenario: cold migration persists a retry identity and removes only an unchanged source after a remote receipt
     */
    checkImportActivation: async () => ({ ready: true, id: remoteVmId, status: 'stopped' }),
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: cold migration persists a retry identity and removes only an unchanged source after a remote receipt
     * 失败 / Failure: `new Error('target launch reply lost')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    activateImport: async () => { throw new Error('target launch reply lost'); },
  } as unknown as HostPeers;
  const bundles = { /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: cold migration persists a retry identity and removes only an unchanged source after a remote receipt
   * 失败 / Failure: `new Error('fake peer handles upload')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  export: async () => { throw new Error('fake peer handles upload'); } } as unknown as Bundles;
  const file = join(root, 'queue.json');
  const options = { peerId, targetName: 'migrated', confirmSourceRemoval: false };
  const first = new ColdMigrations(machines, bundles, peers, file);
  await first.init();
  assert.equal((await first.preview(vmId, {})).ready, false);
  assert.match((await first.preview(vmId, { ...options,
    confirmSourceRemoval: true, startTarget: true })).reason || '', /先完成一次/);
  const copied = await first.run(vmId, options, new AbortController().signal);
  assert.equal(copied.phase, 'copied');
  assert.equal(deletions, 0);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  delete stored.entries[0].remoteVmId;
  stored.entries[0].status = 'review';
  await writeFile(file, JSON.stringify(stored));
  eligible = false;
  const restarted = new ColdMigrations(machines, bundles, peers, file);
  await restarted.init();
  assert.equal((await restarted.preview(vmId, options)).ready, true);
  await assert.rejects(restarted.run(vmId, { ...options,
    confirmSourceRemoval: true, startTarget: true }, new AbortController().signal), /当前不可选/);
  assert.equal(deletions, 0);
  eligible = true;
  await assert.rejects(restarted.run(vmId, { ...options,
    confirmSourceRemoval: true, startTarget: true }, new AbortController().signal),
  /源实例已移除，但目标启动未确认/);
  assert.equal(deletions, 1);
  assert.equal(restarted.view().entries[0].status, 'moved');
  assert.match(restarted.view().entries[0].error || '', /启动未确认/);
  assert.equal(transfers.length, 2);
  assert.equal(transfers[0], transfers[1]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a changed source is retained even when the remote copy exists
 * 状态影响 / State effects: `recordHash`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.rejects(service.run(vmId, { ...options, confirmSourceRemoval: true }, new AbortController().signal), /源实例与之前/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a changed source is retained even when the remote copy exists', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-cold-change-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vmId = randomUUID();
  const peerId = randomUUID();
  const remoteId = randomUUID();
  let recordHash = 'a'.repeat(64);
  const machines = {
    records: new Map([[vmId, {}]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ cpus: 2, memoryMiB: 1024 })`）。
     * Result: Return the branch-computed value (`({ cpus: 2, memoryMiB: 1024 })`).
     * 验证场景 / Scenario: a changed source is retained even when the remote copy exists
     */
    get: () => ({ cpus: 2, memoryMiB: 1024 }),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a changed source is retained even when the remote copy exists
     */
    requireStopped: () => {},
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ recordHash, diskSize: 1024, diskMtimeMs: 1234 })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ recordHash, diskSize: 1024, diskMtimeMs: 1234 })`) through a Promise.
     * 验证场景 / Scenario: a changed source is retained even when the remote copy exists
     */
    migrationFingerprint: async () => ({ recordHash, diskSize: 1024, diskMtimeMs: 1234 }),
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a changed source is retained even when the remote copy exists
     * 失败 / Failure: `new Error('source must survive')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    delete: async () => { throw new Error('source must survive'); },
  } as unknown as Machines;
  const peers = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] })`）。
     * Result: Return the branch-computed value (`({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] })`).
     * 验证场景 / Scenario: a changed source is retained even when the remote copy exists
     */
    view: () => ({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ candidates: [{ id: remoteId, source: 'peer', eligible: true, score: 90, reaso…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ candidates: [{ id: remoteId, source: 'peer', eligible: true, score: 90, reaso…`) through a Promise.
     * 验证场景 / Scenario: a changed source is retained even when the remote copy exists
     */
    score: async () => ({ candidates: [{ id: remoteId, source: 'peer', eligible: true,
      score: 90, reasons: [], status: { platform: 'win32', arch: 'x64' } }] }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ platform: 'win32', arch: 'x64' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ platform: 'win32', arch: 'x64' })`) through a Promise.
     * 验证场景 / Scenario: a changed source is retained even when the remote copy exists
     */
    status: async () => ({ platform: 'win32', arch: 'x64' }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id: randomUUID(), name: 'migrated' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ id: randomUUID(), name: 'migrated' })`) through a Promise.
     * 验证场景 / Scenario: a changed source is retained even when the remote copy exists
     * 协作入口 / Collaborators: `randomUUID`.
     */
    upload: async () => ({ id: randomUUID(), name: 'migrated' }),
  } as unknown as HostPeers;
  const service = new ColdMigrations(machines, {} as Bundles, peers, join(root, 'queue.json'));
  await service.init();
  const options = { peerId, targetName: 'migrated', confirmSourceRemoval: false };
  await service.run(vmId, options, new AbortController().signal);
  recordHash = 'b'.repeat(64);
  await assert.rejects(service.run(vmId, { ...options, confirmSourceRemoval: true },
    new AbortController().signal), /源实例与之前/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an interrupted transfer becomes reviewable and retryable after restart
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.equal(service.view().entries[0].status, 'review')`; `assert.match(service.view().entries[0].error || '', /服务重启/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('an interrupted transfer becomes reviewable and retryable after restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-cold-restart-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vmId = randomUUID();
  const file = join(root, 'queue.json');
  await writeFile(file, JSON.stringify({ version: 1, entries: [{ vmId,
    transferId: randomUUID(), peerId: randomUUID(), targetName: 'migrated',
    fingerprint: { recordHash: 'a'.repeat(64), diskSize: 1, diskMtimeMs: 1 },
    status: 'transferring', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString() }] }));
  const service = new ColdMigrations({} as Machines, {} as Bundles, {} as HostPeers, file);
  await service.init();
  assert.equal(service.view().entries[0].status, 'review');
  assert.match(service.view().entries[0].error || '', /服务重启/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: maintenance drain copies every stopped VM before allowing a reviewed removal pass
 * 状态影响 / State effects: `running`, `failBeta`, `changedBeta`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.equal((await service.previewDrain({ ...copy, targetNames: { [randomUUID()]: 'unused' } })).ready, false)`; `assert.equal((await service.previewDrain({ ...copy, targetNames: { [secondId]: 'alpha' } })).ready, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('maintenance drain copies every stopped VM before allowing a reviewed removal pass', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-maintenance-drain-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const peerId = randomUUID();
  const remoteId = randomUUID();
  const firstId = randomUUID();
  const secondId = randomUUID();
  const records = new Map<string, { id: string; name: string; cpus: number; memoryMiB: number }>([
    [firstId, { id: firstId, name: 'alpha', cpus: 2, memoryMiB: 1024 }],
    [secondId, { id: secondId, name: 'beta', cpus: 2, memoryMiB: 1024 }],
  ]);
  let running: string = secondId;
  let failBeta = true;
  let changedBeta = false;
  const receipts = new Map<string, { id: string; name: string }>();
  const transfers = new Map<string, string[]>();
  const deleted: string[] = [];
  const machines = {
    records,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`vm`）。
     * Result: Return the branch-computed value (`vm`).
     * 验证场景 / Scenario: maintenance drain copies every stopped VM before allowing a reviewed removal pass
     * 失败 / Failure: `new Error('missing')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `records.get`.
     */
    get: (id: string) => {
      const vm = records.get(id);
      if (!vm) throw new Error('missing');
      return vm;
    },
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: id: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: maintenance drain copies every stopped VM before allowing a reviewed removal pass
     * 失败 / Failure: `new Error('请先停止实例')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    requireStopped: (id: string) => {
      if (id === running) throw new Error('请先停止实例');
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`({ recordHash: id === secondId && changedBeta ? 'a'.repeat(64) : id.replaceAll('…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ recordHash: id === secondId && changedBeta ? 'a'.repeat(64) : id.replaceAll('…`) through a Promise.
     * 验证场景 / Scenario: maintenance drain copies every stopped VM before allowing a reviewed removal pass
     * 协作入口 / Collaborators: `'a'.repeat`, `id.replaceAll('-', '').padEnd`, `id.replaceAll`.
     */
    migrationFingerprint: async (id: string) => ({ recordHash: id === secondId && changedBeta
      ? 'a'.repeat(64) : id.replaceAll('-', '').padEnd(64, '0'),
      diskSize: 1024, diskMtimeMs: 1234 }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: id: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: maintenance drain copies every stopped VM before allowing a reviewed removal pass
     * 协作入口 / Collaborators: `deleted.push`, `records.delete`.
     */
    delete: async (id: string) => {
      deleted.push(id);
      records.delete(id);
    },
  } as unknown as Machines;
  const peers = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] })`）。
     * Result: Return the branch-computed value (`({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] })`).
     * 验证场景 / Scenario: maintenance drain copies every stopped VM before allowing a reviewed removal pass
     */
    view: () => ({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ candidates: [{ id: remoteId, source: 'peer', eligible: true, score: 90, reaso…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ candidates: [{ id: remoteId, source: 'peer', eligible: true, score: 90, reaso…`) through a Promise.
     * 验证场景 / Scenario: maintenance drain copies every stopped VM before allowing a reviewed removal pass
     */
    score: async () => ({ candidates: [{ id: remoteId, source: 'peer', eligible: true,
      score: 90, reasons: [], status: { platform: 'win32', arch: 'x64' } }] }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ platform: 'win32', arch: 'x64' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ platform: 'win32', arch: 'x64' })`) through a Promise.
     * 验证场景 / Scenario: maintenance drain copies every stopped VM before allowing a reviewed removal pass
     */
    status: async () => ({ platform: 'win32', arch: 'x64' }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _peer: string; transferId: string; name: string。
     * 结果：返回分支计算值（`receipts.get(transferId)!`），以 Promise 交付。
     * Result: Return the branch-computed value (`receipts.get(transferId)!`) through a Promise.
     * 验证场景 / Scenario: maintenance drain copies every stopped VM before allowing a reviewed removal pass
     * 失败 / Failure: `new Error('temporary transfer failure')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `transfers.set`, `transfers.get`, `receipts.has`, `receipts.set`.
     */
    upload: async (_peer: string, transferId: string, name: string) => {
      transfers.set(name, [...(transfers.get(name) || []), transferId]);
      if (name === 'beta' && failBeta) throw new Error('temporary transfer failure');
      if (!receipts.has(transferId)) receipts.set(transferId, { id: randomUUID(), name });
      return receipts.get(transferId)!;
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _peer: string; transferId: string。
     * 结果：返回分支计算值（`receipts.get(transferId) || null`），以 Promise 交付。
     * Result: Return the branch-computed value (`receipts.get(transferId) || null`) through a Promise.
     * 验证场景 / Scenario: maintenance drain copies every stopped VM before allowing a reviewed removal pass
     * 协作入口 / Collaborators: `receipts.get`.
     */
    importStatus: async (_peer: string, transferId: string) => receipts.get(transferId) || null,
  } as unknown as HostPeers;
  const service = new ColdMigrations(machines, {} as Bundles, peers, join(root, 'queue.json'));
  await service.init();
  const copy = { peerId, confirmSourceRemoval: false };
  const remove = { peerId, confirmSourceRemoval: true };
  assert.equal((await service.previewDrain({ ...copy,
    targetNames: { [randomUUID()]: 'unused' } })).ready, false);
  assert.equal((await service.previewDrain({ ...copy,
    targetNames: { [secondId]: 'alpha' } })).ready, false);
  const blocked = await service.previewDrain(copy);
  assert.equal(blocked.ready, false);
  assert.match(JSON.stringify(blocked.machines), /请先停止实例/);
  running = '';
  await assert.rejects(service.runDrain(remove, new AbortController().signal), /尚无已确认/);
  assert.equal(deleted.length, 0);
  await assert.rejects(service.runDrain(copy, new AbortController().signal), /temporary transfer failure/);
  assert.equal(deleted.length, 0);
  failBeta = false;
  const copied = await service.runDrain(copy, new AbortController().signal);
  assert.equal(copied.phase, 'copied');
  assert.equal(copied.remainingSourceVms, 2);
  assert.equal(deleted.length, 0);
  assert.equal(new Set(transfers.get('beta')).size, 1);
  assert.equal(new Set(transfers.get('alpha')).size, 1);
  changedBeta = true;
  assert.equal((await service.previewDrain(copy)).ready, false);
  const namedCopy = { ...copy, targetNames: { [secondId]: 'beta-updated' } };
  const namedRemove = { ...remove, targetNames: namedCopy.targetNames };
  assert.equal((await service.previewDrain(namedCopy)).ready, true);
  await service.runDrain(namedCopy, new AbortController().signal);
  const betaTransfer = transfers.get('beta-updated')![0];
  const betaReceipt = receipts.get(betaTransfer)!;
  receipts.delete(betaTransfer);
  assert.equal((await service.previewDrain(namedRemove)).ready, false);
  receipts.set(betaTransfer, betaReceipt);
  const moved = await service.runDrain(namedRemove, new AbortController().signal);
  assert.equal(moved.phase, 'moved');
  assert.equal(moved.remainingSourceVms, 0);
  assert.deepEqual(new Set(deleted), new Set([firstId, secondId]));
});
