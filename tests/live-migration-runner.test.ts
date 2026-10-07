/**
 * 模块职责：回归验证模块，围绕 `live-migration-runner` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `live-migration-runner`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: source coordinator fences before confirming target and stops source only after readiness; pre-fence failure aborts a paused target only after source is confirmed running.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { HostPeers } from '../server/host-peers.ts';
import type { qmp } from '../server/qmp.ts';
import type { migrateQemuWithMirroredDisk } from '../server/live-migration-transport.ts';
import type { LiveMigrationFence } from '../shared/contracts/vm.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-live-runner-'));
process.env.SAKURA_DATA_DIR = root;
const { LiveMigrationRunner } = await import('../server/live-migration-runner.ts');
const { createLiveMigrationCompletionPort } = await import('../server/live-migration-proof.ts');
const { migrateQemuWithMirroredDisk: transportQemu } = await import('../server/live-migration-transport.ts');
const { vmDir } = await import('../server/model.ts');
after(async () => {
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
      !basename(resolved).startsWith('sakura-live-runner-'))
    throw new Error('Refusing unexpected test cleanup path');
  await rm(resolved, { recursive: true, force: true });
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: mode: 'success' | 'before-fence' | 'after-fence'。
 * 结果：返回受控对象，公开字段包括 `runner, vmId, hostId, vm, machines, peers, query, transport, counts`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `runner, vmId, hostId, vm, machines, peers, query, transport, counts`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `vmDir`, `mkdir`, `writeFile`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture(mode: 'success' | 'before-fence' | 'after-fence') {
  const vmId = randomUUID(), hostId = randomUUID(), targetVmId = randomUUID(), peerId = randomUUID(), sourceHostId = randomUUID();
  const dir = vmDir(vmId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'id_rsa'), 'private key');
  await writeFile(join(dir, 'seed.iso'), 'seed content');
  await writeFile(join(dir, 'projects.json'), JSON.stringify({ active: 'default',
    projects: [{ id: 'default', name: 'Default' }] }));
  await writeFile(join(dir, 'project.json'), JSON.stringify({
    directory: '/workspace', command: 'printf migrated',
  }));
  const vm = { id: vmId, name: 'source', memoryMiB: 512, cpus: 2,
    diskGiB: 8, accelerator: 'tcg', forwards: [], snapshots: [],
    organization: { group: 'engineering', tags: ['important'], favorite: true },
    liveMigrationFence: undefined as LiveMigrationFence | undefined };
  let stopped = 0, aborted = 0, closed = 0, prepared = 0, completed = 0;
  const live = { status: 'running', accelerator: 'tcg', qmpPort: 1234 };
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`vm`）。
     * Result: Return the branch-computed value (`vm`).
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(id, vmId)`.
     */
    get: (id: string) => { assert.equal(id, vmId); return vm; },
    live: new Map([[vmId, live]]),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; work: () => Promise<T>。
     * 结果：返回分支计算值（`work()`），以 Promise 交付。
     * Result: Return the branch-computed value (`work()`) through a Promise.
     * 协作入口 / Collaborators: `work`.
     */
    locked: async <T>(_id: string, work: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<T>) => work(),
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: _id: string; fence: typeof vm.liveMigrationFence。
     * 结果：返回分支计算值（`vm.liveMigrationFence`），以 Promise 交付。
     * Result: Return the branch-computed value (`vm.liveMigrationFence`) through a Promise.
     * 状态影响 / State effects: `vm.liveMigrationFence`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `new Date().toISOString`, `randomUUID`.
     */
    fenceForLiveMigration: async (_id: string, fence: typeof vm.liveMigrationFence) => {
      vm.liveMigrationFence = { ...fence!, fencedAt: new Date().toISOString(), sourceProcessId: randomUUID() };
      return vm.liveMigrationFence;
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    stop: async () => { stopped++; },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回布尔判定，供用例选择路径或核对受控条件。
     * Result: Return a boolean decision for path selection or controlled-condition assertions.
     */
    canConfirmLiveMigrationCompletion: () => true,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回布尔判定，供用例选择路径或核对受控条件。
     * Result: Return a boolean decision for path selection or controlled-condition assertions.
     */
    isLiveMigrationCompletionDurable: () => true,
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id: string; fence: LiveMigrationFence。
     * 结果：返回分支计算值（`vm.liveMigrationFence = { ...fence, sourceStopped: { sourceProcessId: fence.sour…`），以 Promise 交付。
     * Result: Return the branch-computed value (`vm.liveMigrationFence = { ...fence, sourceStopped: { sourceProcessId: fence.sour…`) through a Promise.
     * 状态影响 / State effects: `vm.liveMigrationFence`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `new Date().toISOString`.
     */
    stopLiveMigrationSource: async (_id: string, fence: LiveMigrationFence) => {
      stopped++;
      return vm.liveMigrationFence = { ...fence, sourceStopped: { sourceProcessId: fence.sourceProcessId!, stoppedAt: new Date().toISOString() } };
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id: string; fence: LiveMigrationFence; inspect: () => Promise<unknown>。
     * 结果：返回分支计算值（`fence`），以 Promise 交付。
     * Result: Return the branch-computed value (`fence`) through a Promise.
     * 协作入口 / Collaborators: `assert.ok`, `inspect`, `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.ok(await inspect())`; `assert.equal(fence.sourceStopped?.sourceProcessId, fence.sourceProcessId)`.
     */
    confirmLiveMigrationCompletion: async (_id: string, fence: LiveMigrationFence, inspect: /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => {
      assert.ok(await inspect());
      assert.equal(fence.sourceStopped?.sourceProcessId, fence.sourceProcessId);
      return fence;
    },
  } as unknown as Machines;
  const peers = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ hostId: sourceHostId, outbound: [{ id: peerId, remoteId: hostId, name: 'Targe…`）。
     * Result: Return the branch-computed value (`({ hostId: sourceHostId, outbound: [{ id: peerId, remoteId: hostId, name: 'Targe…`).
     */
    view: () => ({ hostId: sourceHostId, outbound: [{ id: peerId, remoteId: hostId, name: 'Target' }] }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ candidates: [ { source: 'local', status: { platform: 'win32', arch: 'x64' } }…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ candidates: [ { source: 'local', status: { platform: 'win32', arch: 'x64' } }…`) through a Promise.
     */
    score: async () => ({ candidates: [
      { source: 'local', status: { platform: 'win32', arch: 'x64' } },
      { source: 'peer', id: hostId, eligible: true, reasons: [],
        status: { platform: 'win32', arch: 'x64' } },
    ] }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _peer: string; input: { sourceVmId: string; config: { name: string }; key: string; seed…。
     * 结果：返回受控对象，公开字段包括 `targetVmId, sessionId, targetDiskNode, diskPort, statePort, completionProtocol`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `targetVmId, sessionId, targetDiskNode, diskPort, statePort, completionProtocol`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.equal`, `Buffer.from(input.seedBase64, 'base64').toString`, `Buffer.from`, `assert.deepEqual`.
     * 检查边界 / Checked boundaries: `assert.equal(input.sourceVmId, vmId)`; `assert.equal(input.config.name, 'destination')`.
     */
    prepareLiveTarget: async (_peer: string, input: { sourceVmId: string;
      config: { name: string }; key: string; seedBase64: string;
      projects?: { configs: { default?: { command: string } } };
      organization?: { group: string; tags: string[]; favorite: boolean } }) => {
      prepared++;
      assert.equal(input.sourceVmId, vmId);
      assert.equal(input.config.name, 'destination');
      assert.equal(input.key, 'private key');
      assert.equal(Buffer.from(input.seedBase64, 'base64').toString(), 'seed content');
      assert.equal(input.projects?.configs.default?.command, 'printf migrated');
      assert.deepEqual(input.organization, vm.organization);
      return { targetVmId, sessionId: randomUUID(), targetDiskNode: '#target',
        diskPort: 2345, statePort: 2346, completionProtocol: 1 as const };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ port: 3456, close: async () => { closed++; } })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ port: 3456, close: async () => { closed++; } })`) through a Promise.
     */
    openMigrationForward: async () => ({ port: 3456,
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       */
      close: async () => { closed++; } }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({})`），以 Promise 交付。
     * Result: Return the branch-computed value (`({})`) through a Promise.
     */
    targetMigrationQmp: async () => ({}),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `targetVmId, status, originStatus, sourceVmId, sourceHostId, sessionId, transferId, projectsDigest, targetVerifiedAt`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `targetVmId, status, originStatus, sourceVmId, sourceHostId, sessionId, transferId, projectsDigest, targetVerifiedAt`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `new Date().toISOString`.
     */
    completeLiveTarget: async () => { completed++; return {
      targetVmId, status: 'running', originStatus: 'ready', sourceVmId: vmId, sourceHostId,
      sessionId: vm.liveMigrationFence!.sessionId, transferId: vm.liveMigrationFence!.transferId,
      projectsDigest: vm.liveMigrationFence!.projectsDigest, targetVerifiedAt: new Date().toISOString() }; },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ targetVmId, status: 'running', originStatus: 'ready', sourceVmId: vmId, sourc…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ targetVmId, status: 'running', originStatus: 'ready', sourceVmId: vmId, sourc…`) through a Promise.
     * 协作入口 / Collaborators: `new Date().toISOString`.
     */
    inspectLiveTarget: async () => ({ targetVmId, status: 'running', originStatus: 'ready', sourceVmId: vmId, sourceHostId,
      sessionId: vm.liveMigrationFence!.sessionId, transferId: vm.liveMigrationFence!.transferId,
      projectsDigest: vm.liveMigrationFence!.projectsDigest, targetVerifiedAt: new Date().toISOString() }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _peer: string; request: { sourceRunning: boolean }。
     * 结果：返回受控对象，公开字段包括 `targetVmId, aborted`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `targetVmId, aborted`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(request.sourceRunning, true)`.
     */
    abortLiveTarget: async (_peer: string, request: { sourceRunning: boolean }) => {
      assert.equal(request.sourceRunning, true); aborted++;
      return { targetVmId, aborted: true };
    },
  } as unknown as HostPeers;
  /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: _port: number; command: string。
   * 结果：返回受控对象，公开字段包括 `running, status`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `running, status`; the actual branch determines its shape.
   * 失败 / Failure: `new Error(`Unexpected ${command}`)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
   * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
   */
  const query = (async (_port: number, command: string) => {
    if (command === 'query-status') return { running: true, status: 'running' };
    if (command === 'query-migrate') return { status: 'none' };
    if (command === 'query-block') return [{ device: 'sakura-disk',
      inserted: { ro: false, 'node-name': '#source' } }];
    throw new Error(`Unexpected ${command}`);
  }) as typeof qmp;
  /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: input: Parameters<typeof migrateQemuWithMirroredDisk>[0]。
   * 结果：返回分支计算值（`{ sourceStopped: true, targetRunning: true, fenced: true } as const`），以 Promise 交付。
   * Result: Return the branch-computed value (`{ sourceStopped: true, targetRunning: true, fenced: true } as const`) through a Promise.
   * 失败 / Failure: `new Error('injected transport failure')`; `new Error('injected cutover failure')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `assert.equal`, `input.fenceSource`.
   * 检查边界 / Checked boundaries: `assert.equal(input.sourceDiskNode, '#source')`; `assert.equal(input.targetDiskNode, '#target')`.
   */
  const transport = (async (input: Parameters<typeof migrateQemuWithMirroredDisk>[0]) => {
    assert.equal(input.sourceDiskNode, '#source');
    assert.equal(input.targetDiskNode, '#target');
    assert.equal(input.incomingUri, 'tcp:127.0.0.1:2346');
    if (mode === 'before-fence') throw new Error('injected transport failure');
    await input.fenceSource();
    if (mode === 'after-fence') throw new Error('injected cutover failure');
    return { sourceStopped: true, targetRunning: true, fenced: true } as const;
  }) as typeof migrateQemuWithMirroredDisk;
  const runner = new LiveMigrationRunner(machines, peers, query, transport,
    createLiveMigrationCompletionPort(machines, () => peers));
  return { runner, vmId, hostId, vm, machines, peers, query, transport,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ prepared, completed, stopped, aborted, closed })`）。
     * Result: Return the branch-computed value (`({ prepared, completed, stopped, aborted, closed })`).
     */
    counts: () => ({ prepared, completed, stopped, aborted, closed }) };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: source coordinator fences before confirming target and stops source only after readiness
 * 协作入口 / Collaborators: `fixture`, `runner.run`, `assert.equal`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(result.executed, true)`; `assert.equal(result.targetHostId, hostId)`.
 */
test('source coordinator fences before confirming target and stops source only after readiness', async () => {
  const { runner, vmId, hostId, vm, counts } = await fixture('success');
  const result = await runner.run(vmId, { targetHostId: hostId, targetName: 'destination' });
  assert.equal(result.executed, true);
  assert.equal(result.targetHostId, hostId);
  assert.equal(vm.liveMigrationFence?.targetVmId, result.targetVmId);
  assert.deepEqual(counts(), { prepared: 1, completed: 1,
    stopped: 1, aborted: 0, closed: 2 });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pre-fence failure aborts a paused target only after source is confirmed running
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `runner.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(runner.run(vmId, { targetHostId: hostId, targetName: 'destination' }), /injected transport failure/)`; `assert.equal(vm.liveMigrationFence, undefined)`.
 */
test('pre-fence failure aborts a paused target only after source is confirmed running', async () => {
  const { runner, vmId, hostId, vm, counts } = await fixture('before-fence');
  await assert.rejects(runner.run(vmId, { targetHostId: hostId,
    targetName: 'destination' }), /injected transport failure/);
  assert.equal(vm.liveMigrationFence, undefined);
  assert.deepEqual(counts(), { prepared: 1, completed: 0,
    stopped: 0, aborted: 1, closed: 2 });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: post-fence failure keeps target and source fence for manual reconciliation
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `runner.run`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.rejects(runner.run(vmId, { targetHostId: hostId, targetName: 'destination' }), /injected cutover failure/)`; `assert.ok(vm.liveMigrationFence)`.
 */
test('post-fence failure keeps target and source fence for manual reconciliation', async () => {
  const { runner, vmId, hostId, vm, counts } = await fixture('after-fence');
  await assert.rejects(runner.run(vmId, { targetHostId: hostId,
    targetName: 'destination' }), /injected cutover failure/);
  assert.ok(vm.liveMigrationFence);
  assert.deepEqual(counts(), { prepared: 1, completed: 0,
    stopped: 0, aborted: 0, closed: 2 });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pre-fence transport rollback cannot resume a source fenced by another request
 * 状态影响 / State effects: `machines.locked`, `peers.targetMigrationQmp`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `randomUUID`, `new Date().toISOString`, `machines.locked.bind`.
 * 检查边界 / Checked boundaries: `assert.rejects(runner.run(vmId, { targetHostId: hostId, targetName: 'destination' }), error => error === failure)`; `assert.equal(resumeLocks, 1)`.
 */
test('pre-fence transport rollback cannot resume a source fenced by another request', async () => {
  const { vmId, hostId, vm, machines, peers, counts } = await fixture('before-fence');
  const failure = new Error('injected receiver failure with concurrent source fence');
  const concurrentFence: LiveMigrationFence = { targetHostId: hostId, targetVmId: randomUUID(),
    transferId: randomUUID(), fencedAt: new Date().toISOString() };
  const slots = [{ type: 'qemu64-x86_64-cpu', props: { 'socket-id': 0 }, 'vcpus-count': 1 }];
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: node: string。
   * 结果：返回列表形式的受控数据，供调用者遍历或比较。
   * Result: Return controlled data as a list for iteration or comparison.
   * 验证场景 / Scenario: pre-fence transport rollback cannot resume a source fenced by another request
   */
  const blocks = (node: string) => [{ device: 'sakura-disk', inserted: { ro: false,
    'node-name': node, image: { 'virtual-size': 8 * 1024 ** 3 } } }];
  let paused = false, resumed = 0, resumeLocks = 0;
  const originalLock = machines.locked.bind(machines);
  machines.locked = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: id; work; args。
   * 结果：返回分支计算值（`originalLock(id, work, ...args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`originalLock(id, work, ...args)`) through a Promise.
   * 验证场景 / Scenario: pre-fence transport rollback cannot resume a source fenced by another request
   * 协作入口 / Collaborators: `originalLock`.
   */
  async (id, work, ...args) => {
    resumeLocks++;
    return originalLock(id, work, ...args);
  };
  /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: _port: number; command: string。
   * 结果：返回受控对象，公开字段包括 `running, status, qemu`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `running, status, qemu`; the actual branch determines its shape.
   * 验证场景 / Scenario: pre-fence transport rollback cannot resume a source fenced by another request
   * 失败 / Failure: `new Error(`Unexpected source command ${command}`)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `blocks`.
   * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
   * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
   */
  const query = (async (_port: number, command: string) => {
    if (command === 'query-status') return { running: !paused, status: paused ? 'paused' : 'running' };
    if (command === 'query-migrate') return { status: 'none' };
    if (command === 'query-block') return blocks('#source');
    if (command === 'query-version') return { qemu: { major: 10, minor: 0, micro: 0 } };
    if (command === 'query-hotpluggable-cpus') return slots;
    if (command === 'cont') { resumed++; return {}; }
    throw new Error(`Unexpected source command ${command}`);
  }) as typeof qmp;
  peers.targetMigrationQmp = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: _peer; _session; command。
   * 结果：返回受控对象，公开字段包括 `running, status, qemu`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `running, status, qemu`; the actual branch determines its shape.
   * 验证场景 / Scenario: pre-fence transport rollback cannot resume a source fenced by another request
   * 状态影响 / State effects: `paused`, `vm.liveMigrationFence`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 失败 / Failure: `failure`; `new Error(`Unexpected target command ${command}`)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `blocks`.
   * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
   * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
   */
  async (_peer, _session, command) => {
    if (command === 'query-status') return { running: false, status: 'prelaunch' };
    if (command === 'query-version') return { qemu: { major: 10, minor: 0, micro: 0 } };
    if (command === 'query-hotpluggable-cpus') return slots;
    if (command === 'query-block') return blocks('#target');
    if (command === 'migrate-incoming') {
      paused = true;
      vm.liveMigrationFence = concurrentFence;
      throw failure;
    }
    throw new Error(`Unexpected target command ${command}`);
  };
  const runner = new LiveMigrationRunner(machines, peers, query, transportQemu,
    createLiveMigrationCompletionPort(machines, () => peers));
  await assert.rejects(runner.run(vmId, { targetHostId: hostId, targetName: 'destination' }),
    error => error === failure);
  assert.equal(resumeLocks, 1);
  assert.equal(resumed, 0);
  assert.equal(vm.liveMigrationFence, concurrentFence);
  assert.deepEqual(counts(), { prepared: 1, completed: 0, stopped: 0, aborted: 0, closed: 2 });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: migration refuses project secrets that cannot follow the guest to another host
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `vmDir`.
 * 检查边界 / Checked boundaries: `assert.rejects(runner.run(vmId, { targetHostId: hostId, targetName: 'destination' }), /宿主私密配置/)`; `assert.equal(counts().prepared, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('migration refuses project secrets that cannot follow the guest to another host', async () => {
  const { runner, vmId, hostId, counts } = await fixture('success');
  await writeFile(join(vmDir(vmId), 'project.json'), JSON.stringify({
    directory: '/workspace', secrets: { TOKEN: 'HostOnlySecret' },
  }));
  await assert.rejects(runner.run(vmId, { targetHostId: hostId,
    targetName: 'destination' }), /宿主私密配置/);
  assert.equal(counts().prepared, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lost prepare response reuses its durable transfer through a new coordinator
 * 状态影响 / State effects: `peers.prepareLiveTarget`, `peers.score`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `peers.prepareLiveTarget.bind`, `assert.rejects`, `runner.run`.
 * 检查边界 / Checked boundaries: `assert.rejects(runner.run(vmId, { targetHostId: hostId, targetName: 'destination' }), /lost prepare response/)`; `assert.equal(vm.liveMigrationFence, undefined)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('lost prepare response reuses its durable transfer through a new coordinator', async () => {
  const { runner, vmId, hostId, vm, machines, peers, query, transport, counts } = await fixture('success');
  const original = peers.prepareLiveTarget.bind(peers);
  const transfers: string[] = [];
  peers.prepareLiveTarget = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: peerId; raw。
   * 结果：返回分支计算值（`receipt`），以 Promise 交付。
   * Result: Return the branch-computed value (`receipt`) through a Promise.
   * 验证场景 / Scenario: lost prepare response reuses its durable transfer through a new coordinator
   * 失败 / Failure: `new Error('injected lost prepare response')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `transfers.push`, `original`.
   */
  async (peerId, raw) => {
    transfers.push((raw as { transferId: string }).transferId);
    const receipt = await original(peerId, raw);
    if (transfers.length === 1) throw new Error('injected lost prepare response');
    return receipt;
  };
  await assert.rejects(runner.run(vmId, { targetHostId: hostId, targetName: 'destination' }), /lost prepare response/);
  assert.equal(vm.liveMigrationFence, undefined);
  const score = peers.score.bind(peers);
  peers.score = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: input。
   * 结果：返回受控对象，公开字段包括 `candidates`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `candidates`; the actual branch determines its shape.
   * 验证场景 / Scenario: lost prepare response reuses its durable transfer through a new coordinator
   * 协作入口 / Collaborators: `score`, `result.candidates.map`.
   */
  async input => {
    const result = await score(input);
    return { ...result, candidates: result.candidates.map(candidate => candidate.source === 'peer'
      ? { ...candidate, eligible: false, reasons: ['prepared target already holds the available resources'] }
      : candidate) };
  };
  const restarted = new LiveMigrationRunner(machines, peers, query, transport,
    createLiveMigrationCompletionPort(machines, () => peers));
  await assert.rejects(restarted.run(vmId, { targetHostId: hostId, targetName: 'destination',
    transferId: randomUUID() }), { code: 'LIVE_MIGRATION_ATTEMPT_CHANGED' });
  await restarted.run(vmId, { targetHostId: hostId, targetName: 'destination', transferId: transfers[0] });
  assert.deepEqual(transfers, [transfers[0], transfers[0]]);
  assert.equal(counts().prepared, 2);
  assert.equal(machines.get(vmId).liveMigrationFence?.transferId, transfers[0]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lost cutover response is recoverable by the original transfer without preparing or transporting again
 * 状态影响 / State effects: `peers.completeLiveTarget`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `peers.completeLiveTarget.bind`, `assert.rejects`, `runner.run`.
 * 检查边界 / Checked boundaries: `assert.rejects(runner.run(vmId, { targetHostId: hostId, targetName: 'destination' }), /lost cutover response/)`; `assert.rejects(restarted.run(vmId, { targetHostId: hostId, transferId: randomUUID() }), /不属于原在线迁移/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('lost cutover response is recoverable by the original transfer without preparing or transporting again', async () => {
  const { runner, vmId, hostId, vm, machines, peers, query, transport, counts } = await fixture('success');
  const original = peers.completeLiveTarget.bind(peers);
  peers.completeLiveTarget = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: peerId; raw。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: lost cutover response is recoverable by the original transfer without preparing or transporting again
   * 失败 / Failure: `new Error('injected lost cutover response')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `original`.
   */
  async (peerId, raw) => {
    await original(peerId, raw);
    throw new Error('injected lost cutover response');
  };
  await assert.rejects(runner.run(vmId, { targetHostId: hostId, targetName: 'destination' }), /lost cutover response/);
  const fence = vm.liveMigrationFence!;
  const restarted = new LiveMigrationRunner(machines, peers, query, transport,
    createLiveMigrationCompletionPort(machines, () => peers));
  await assert.rejects(restarted.run(vmId, { targetHostId: hostId, transferId: randomUUID() }), /不属于原在线迁移/);
  const result = await restarted.run(vmId, { targetHostId: hostId, transferId: fence.transferId });
  assert.equal(result.transferId, fence.transferId);
  assert.deepEqual(counts(), { prepared: 1, completed: 1, stopped: 1, aborted: 0, closed: 2 });
  assert.equal(vm.liveMigrationFence?.transferId, fence.transferId);
});
