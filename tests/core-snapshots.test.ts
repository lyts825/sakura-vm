/**
 * 模块职责：回归验证模块，围绕 `core-snapshots` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `core-snapshots`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: disk growth creates a recovery snapshot and restores its original capacity metadata; disk growth preserves legacy snapshot capacity across multiple expansions.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';
import { vmLifetime } from '../server/vm-lifetime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-core-snapshots-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-core-snapshots-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext。
 * 结果：返回受控对象，公开字段包括 `machines, id, dir, commands`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, id, dir, commands`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `machines.init`, `randomUUID`, `machines.records.set`, `createSchema.parse`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture(t: TestContext) {
  const commands: string[][] = [];
  const machines = new Machines({
    runtime: { /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    close: async () => {} },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool; args。
     * 结果：返回分支计算值（`''`），以 Promise 交付。
     * Result: Return the branch-computed value (`''`) through a Promise.
     * 协作入口 / Collaborators: `commands.push`.
     */
    run: async (_tool, args) => {
      commands.push(args);
      return '';
    },
  } as Engine, fakeVmNetwork);
  await machines.init();
  const id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'snapshot-test' }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  const dir = vmDir(id);
  await mkdir(dir);
  await writeFile(join(dir, 'id_rsa'), 'original-private-key');
  await writeFile(join(dir, 'seed.iso'), 'original-seed');
  t.after(() => machines.close());
  return { machines, id, dir, commands };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: disk growth creates a recovery snapshot and restores its original capacity metadata
 * 协作入口 / Collaborators: `fixture`, `machines.resize`, `assert.equal`, `machines.get`.
 * 检查边界 / Checked boundaries: `assert.equal(machines.get(id).diskGiB, 16)`; `assert.ok(machines.get(id).pendingResize)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('disk growth creates a recovery snapshot and restores its original capacity metadata', async (t) => {
  const { machines, id, commands } = await fixture(t);
  await machines.resize(id, 16);
  assert.equal(machines.get(id).diskGiB, 16);
  assert.ok(machines.get(id).pendingResize);
  const shot = machines.get(id).snapshots[0];
  assert.equal(shot.diskGiB, 8);
  assert.equal(commands[0][0], 'snapshot');
  assert.equal(commands[1][0], 'resize');
  await assert.rejects(machines.resize(id, 4), /仅支持扩容/);
  await machines.restore(id, shot.id);
  assert.equal(machines.get(id).diskGiB, 8);
  assert.equal(machines.get(id).pendingResize, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: disk growth preserves legacy snapshot capacity across multiple expansions
 * 协作入口 / Collaborators: `fixture`, `randomUUID`, `new Date().toISOString`, `machines.get(id).snapshots.push`.
 * 检查边界 / Checked boundaries: `assert.equal(machines.get(id).snapshots.find((shot) => shot.id === legacy.id)?.diskGiB, 8)`; `assert.equal(machines.get(id).diskGiB, 8)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('disk growth preserves legacy snapshot capacity across multiple expansions', async (t) => {
  const { machines, id } = await fixture(t);
  const legacy = { id: randomUUID(), name: 'legacy', createdAt: new Date().toISOString() };
  machines.get(id).snapshots.push(legacy);
  await machines.resize(id, 16);
  await machines.resize(id, 24);
  assert.equal(machines.get(id).snapshots.find((shot) => shot.id === legacy.id)?.diskGiB, 8);
  await machines.restore(id, legacy.id);
  assert.equal(machines.get(id).diskGiB, 8);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: snapshots restore unfinished filesystem growth and preserve it in recovery backups
 * 协作入口 / Collaborators: `fixture`, `machines.resize`, `machines.snapshot`, `machines.completeResize`.
 * 检查边界 / Checked boundaries: `assert.equal(machines.get(id).diskGiB, 16)`; `assert.equal(machines.get(id).pendingResize, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('snapshots restore unfinished filesystem growth and preserve it in recovery backups', async (t) => {
  const { machines, id } = await fixture(t);
  await machines.resize(id, 16);
  const pending = await machines.snapshot(id, 'filesystem-growth-pending');
  await machines.completeResize(id);
  const completed = await machines.snapshot(id, 'filesystem-growth-complete');

  await machines.restore(id, pending.id);
  assert.equal(machines.get(id).diskGiB, 16);
  assert.equal(machines.get(id).pendingResize, true);
  await machines.restore(id, completed.id, true);
  assert.equal(machines.get(id).pendingResize, false);
  const recovery = machines.get(id).snapshots.find((shot) => shot.name === '恢复前自动备份')!;
  await machines.restore(id, recovery.id);
  assert.equal(machines.get(id).pendingResize, true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: restoring a pre-first-boot snapshot restores the matching controller and pending identity
 * 协作入口 / Collaborators: `fixture`, `JSON.stringify`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(await readFile(join(dir, 'id_rsa'), 'utf8'), 'original-private-key')`; `assert.equal(await readFile(join(dir, 'identity.json'), 'utf8'), pending)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('restoring a pre-first-boot snapshot restores the matching controller and pending identity', async (t) => {
  const { machines, id, dir } = await fixture(t);
  const pending = JSON.stringify({ privateText: 'new-private-key', publicText: 'new-public-key' });
  await writeFile(join(dir, 'identity.json'), pending);
  const snapshot = await machines.snapshot(id, 'before-first-boot');
  await writeFile(join(dir, 'id_rsa'), 'new-private-key');
  await rm(join(dir, 'identity.json'));
  await machines.restore(id, snapshot.id);
  assert.equal(await readFile(join(dir, 'id_rsa'), 'utf8'), 'original-private-key');
  assert.equal(await readFile(join(dir, 'identity.json'), 'utf8'), pending);
  const identity = await machines.snapshotIdentity(id, snapshot.id);
  assert.equal(identity.key, 'original-private-key');
  assert.equal(identity.seed.toString(), 'original-seed');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: restoring a later snapshot removes stale pending rotation and preserves a usable restore backup
 * 协作入口 / Collaborators: `fixture`, `machines.snapshot`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(await readFile(join(dir, 'id_rsa'), 'utf8'), 'original-private-key')`; `assert.rejects(readFile(join(dir, 'identity.json')), { code: 'ENOENT' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('restoring a later snapshot removes stale pending rotation and preserves a usable restore backup', async (t) => {
  const { machines, id, dir } = await fixture(t);
  const snapshot = await machines.snapshot(id, 'completed-boot');
  await writeFile(join(dir, 'id_rsa'), 'other-private-key');
  await writeFile(join(dir, 'identity.json'), '{"privateText":"pending-key"}');
  await machines.restore(id, snapshot.id, true);
  assert.equal(await readFile(join(dir, 'id_rsa'), 'utf8'), 'original-private-key');
  await assert.rejects(readFile(join(dir, 'identity.json')), { code: 'ENOENT' });
  const backup = machines.get(id).snapshots.find((entry) => entry.id !== snapshot.id)!;
  assert.equal((await machines.snapshotIdentity(id, backup.id)).key, 'other-private-key');
  await machines.restore(id, backup.id);
  assert.equal(await readFile(join(dir, 'id_rsa'), 'utf8'), 'other-private-key');
  assert.equal(await readFile(join(dir, 'identity.json'), 'utf8'), '{"privateText":"pending-key"}');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy snapshots without identity metadata keep their existing controller identity
 * 协作入口 / Collaborators: `fixture`, `randomUUID`, `new Date().toISOString`, `machines.get(id).snapshots.push`.
 * 检查边界 / Checked boundaries: `assert.equal(await readFile(join(dir, 'id_rsa'), 'utf8'), 'original-private-key')`; `assert.equal((await machines.snapshotIdentity(id, legacy.id)).key, 'original-private-key')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('legacy snapshots without identity metadata keep their existing controller identity', async (t) => {
  const { machines, id, dir } = await fixture(t);
  const legacy = { id: randomUUID(), name: 'legacy', createdAt: new Date().toISOString() };
  machines.get(id).snapshots.push(legacy);
  await machines.restore(id, legacy.id);
  assert.equal(await readFile(join(dir, 'id_rsa'), 'utf8'), 'original-private-key');
  assert.equal((await machines.snapshotIdentity(id, legacy.id)).key, 'original-private-key');
  await assert.rejects(machines.snapshotIdentity(id, randomUUID()), /不存在/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a guest exiting during network renewal releases the new generation without reviving its Live
 * 状态影响 / State effects: `shot.consistency`, `shot.stateFingerprint`, `(machines as any).vmStateFingerprint`, `old.renew`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `machines.snapshot`, `fakeVmNetwork.attachVm`, `machines.live.set`.
 * 检查边界 / Checked boundaries: `assert.rejects(restoring, /已退出/)`; `assert.equal(renewed.signal.aborted, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a guest exiting during network renewal releases the new generation without reviving its Live', async (t) => {
  const { machines, id } = await fixture(t);
  const shot = await machines.snapshot(id, 'memory-fixture');
  shot.consistency = 'vmstate';
  shot.stateFingerprint = 'fixture';
  (machines as any).vmStateFingerprint = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'fixture'`），以 Promise 交付。
   * Result: Return the branch-computed value (`'fixture'`) through a Promise.
   * 验证场景 / Scenario: a guest exiting during network renewal releases the new generation without reviving its Live
   */
  async () => 'fixture';
  const options = { vmId: id, generation: 'before', isolated: false,
    sshPort: 35001, forwards: [], /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a guest exiting during network renewal releases the new generation without reviving its Live
     */
    onFailure: () => {} };
  const old = await fakeVmNetwork.attachVm(options);
  const renewed = await fakeVmNetwork.attachVm({ ...options, generation: 'after' });
  let startRenew!: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, finishRenew!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const started = new Promise<void>((resolve) => { startRenew = resolve; });
  const finished = new Promise<void>((resolve) => { finishRenew = resolve; });
  old.renew = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`renewed`），以 Promise 交付。
   * Result: Return the branch-computed value (`renewed`) through a Promise.
   * 验证场景 / Scenario: a guest exiting during network renewal releases the new generation without reviving its Live
   * 协作入口 / Collaborators: `startRenew`.
   */
  async () => { startRenew(); await finished; return renewed; };
  const live = { status: 'running', accelerator: 'tcg', network: old,
    clients: new Set(), abort: new AbortController(), bootAbort: new AbortController() } as any;
  machines.live.set(id, live);
  const restoring = machines.restoreMemory(id, shot.id);
  await started;
  live.abort.abort();
  machines.live.delete(id);
  finishRenew();
  await assert.rejects(restoring, /已退出/);
  assert.equal(renewed.signal.aborted, true);
  assert.equal(machines.live.has(id), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: RAM restore advances execution and NIC generations while preserving process identity and observing the real restored boot
 * 状态影响 / State effects: `shot.consistency`, `shot.stateFingerprint`, `(machines as any).vmStateFingerprint`, `(machines as any).connectSerial`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `machines.snapshot`, `createServer`, `monitor.listen`.
 * 检查边界 / Checked boundaries: `assert.notEqual(restored, live)`; `assert.equal(restored.lifetime, lifetime)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('RAM restore advances execution and NIC generations while preserving process identity and observing the real restored boot', async (t) => {
  const { machines, id } = await fixture(t);
  const shot = await machines.snapshot(id, 'memory-fixture');
  shot.consistency = 'vmstate'; shot.stateFingerprint = 'fixture';
  (machines as any).vmStateFingerprint = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'fixture'`），以 Promise 交付。
   * Result: Return the branch-computed value (`'fixture'`) through a Promise.
   * 验证场景 / Scenario: RAM restore advances execution and NIC generations while preserving process identity and observing the real restored boot
   */
  async () => 'fixture';
  const commands: string[] = [];
  let jobId = '', serialConnections = 0, serialCloses = 0;
  (machines as any).connectSerial = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: RAM restore advances execution and NIC generations while preserving process identity and observing the real restored boot
   */
  () => { serialConnections++; };
  const monitor = createServer(/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: socket。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: RAM restore advances execution and NIC generations while preserving process identity and observing the real restored boot
   * 协作入口 / Collaborators: `socket.write`, `JSON.stringify`, `socket.setEncoding`, `socket.on`.
   */
  socket => {
    socket.write(JSON.stringify({ QMP: { version: {}, capabilities: [] } }) + '\n');
    socket.setEncoding('utf8');
    let input = '';
    socket.on('data', /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: data: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: RAM restore advances execution and NIC generations while preserving process identity and observing the real restored boot
     * 状态影响 / State effects: `input`, `index`, `jobId`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `input.indexOf`, `JSON.parse`, `input.slice`, `commands.push`.
     */
    (data: string) => {
      input += data;
      let index: number;
      while ((index = input.indexOf('\n')) >= 0) {
        const command = JSON.parse(input.slice(0, index)); input = input.slice(index + 1);
        commands.push(command.execute);
        if (command.execute === 'snapshot-load') jobId = command.arguments['job-id'];
        const result = command.execute === 'query-block'
          ? [{ device: 'sakura-disk', inserted: { 'node-name': 'disk-node', drv: 'qcow2', ro: false } }]
          : command.execute === 'query-jobs' ? [{ id: jobId, status: 'concluded' }]
          : command.execute === 'query-status' ? { running: true } : {};
        socket.write(JSON.stringify({ id: command.id, return: result }) + '\n');
      }
    });
  });
  monitor.listen(0, '127.0.0.1'); await once(monitor, 'listening');
  const qmpPort = (monitor.address() as { port: number }).port;
  const network = await fakeVmNetwork.attachVm({ vmId: id, generation: 'initial', sshPort: 35001,
    forwards: [], isolated: false, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: RAM restore advances execution and NIC generations while preserving process identity and observing the real restored boot
     */
    onFailure: () => {} });
  const live = { status: 'running', accelerator: 'tcg', network, qmpPort,
    clients: new Set(), serial: { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: RAM restore advances execution and NIC generations while preserving process identity and observing the real restored boot
     */
    destroy: () => { serialCloses++; } },
    abort: new AbortController(), bootAbort: new AbortController() } as any;
  machines.live.set(id, live);
  const lifetime = vmLifetime(id, live), rebootedBoot = randomUUID(), restoredBoot = randomUUID();
  await lifetime.setNetwork(network); lifetime.observeBoot(rebootedBoot);
  const identity = lifetime.capture();
  try {
    await machines.restoreMemory(id, shot.id);
    const restored = machines.live.get(id)!;
    assert.notEqual(restored, live); assert.equal(restored.lifetime, lifetime);
    assert.equal(restored.status, 'running');
    assert.equal(lifetime.capture().vmProcessId, identity.vmProcessId);
    assert.notEqual(lifetime.capture().executionGeneration, identity.executionGeneration);
    assert.notEqual(lifetime.capture().networkGeneration, identity.networkGeneration);
    assert.equal(lifetime.capture().bootId, undefined);
    assert.equal(lifetime.lastObservedBootId, rebootedBoot);
    const generation = lifetime.capture().executionGeneration;
    lifetime.observeBoot(restoredBoot);
    assert.equal(lifetime.capture().bootId, restoredBoot);
    assert.equal(lifetime.capture().executionGeneration, generation);
    assert.equal(serialConnections, 1); assert.equal(serialCloses, 1);
    assert.equal(commands.includes('stop') || commands.includes('cont'), false);
    assert.ok(commands.includes('snapshot-load'));
  } finally {
    await lifetime.close(); machines.live.delete(id);
    await new Promise<void>(resolve => monitor.close(() => resolve()));
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed online disk snapshot thaws the guest and removes its identity metadata
 * 协作入口 / Collaborators: `fixture`, `createServer`, `agent.listen`, `monitor.listen`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.onlineSnapshot(id, 'failed'), /disk unavailable/)`; `assert.deepEqual(agentCommands, ['guest-ping', 'guest-fsfreeze-freeze', 'guest-fsfreeze-thaw'])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('failed online disk snapshot thaws the guest and removes its identity metadata', async (t) => {
  const { machines, id, dir } = await fixture(t);
  const agentCommands: string[] = [];
  const agent = createServer(/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: socket。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: failed online disk snapshot thaws the guest and removes its identity metadata
   * 协作入口 / Collaborators: `socket.setEncoding`, `socket.on`.
   */
  (socket) => {
    socket.setEncoding('utf8');
    let input = '';
    socket.on('data', (data: string) => {
      input += data;
      let index: number;
      while ((index = input.indexOf('\n')) >= 0) {
        const command = JSON.parse(input.slice(0, index));
        input = input.slice(index + 1);
        agentCommands.push(command.execute);
        socket.write(JSON.stringify({ id: command.id,
          return: command.execute.startsWith('guest-fsfreeze-') ? 1 : {} }) + '\n');
      }
    });
  });
  const monitor = createServer(/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: socket。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: failed online disk snapshot thaws the guest and removes its identity metadata
   * 协作入口 / Collaborators: `socket.write`, `JSON.stringify`, `socket.setEncoding`, `socket.on`.
   */
  (socket) => {
    socket.write(JSON.stringify({ QMP: { version: { qemu: { major: 9, minor: 0, micro: 0 }, package: '' },
      capabilities: [] } }) + '\n');
    socket.setEncoding('utf8');
    let input = '';
    socket.on('data', (data: string) => {
      input += data;
      let index: number;
      while ((index = input.indexOf('\n')) >= 0) {
        const command = JSON.parse(input.slice(0, index));
        input = input.slice(index + 1);
        socket.write(JSON.stringify(command.execute === 'qmp_capabilities'
          ? { id: command.id, return: {} }
          : { id: command.id, error: { class: 'GenericError', desc: 'disk unavailable' } }) + '\n');
      }
    });
  });
  agent.listen(0, '127.0.0.1');
  monitor.listen(0, '127.0.0.1');
  await Promise.all([once(agent, 'listening'), once(monitor, 'listening')]);
  const agentPort = (agent.address() as { port: number }).port;
  const qmpPort = (monitor.address() as { port: number }).port;
  machines.live.set(id, { status: 'running', agentPort, qmpPort } as any);
  try {
    await assert.rejects(machines.onlineSnapshot(id, 'failed'), /disk unavailable/);
    assert.deepEqual(agentCommands,
      ['guest-ping', 'guest-fsfreeze-freeze', 'guest-fsfreeze-thaw']);
    assert.deepEqual(machines.get(id).snapshots, []);
    assert.equal((await readdir(dir)).filter((name) => name.startsWith('.snapshot-')).length, 0);
  } finally {
    machines.live.delete(id);
    await Promise.all([
      new Promise<void>((resolve) => agent.close(() => resolve())),
      new Promise<void>((resolve) => monitor.close(() => resolve())),
    ]);
  }
});
