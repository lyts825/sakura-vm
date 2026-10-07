/**
 * 模块职责：回归验证模块，围绕 `disk-maintenance` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `disk-maintenance`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: compaction holds the lifecycle lock until publication and cancellation preserves the original disk; failed image comparison cannot replace the source and successful compaction verifies before publishing.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'sakura-disk-maintenance-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Maintenance } = await import('../server/maintenance.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
const { diskMaintenanceState, diskMaintenanceDue, runDiskMaintenance, saveDiskMaintenancePolicy } =
  await import('../server/disk-maintenance.ts');
const { saveMaintenancePolicy } = await import('../server/automation-policy.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-disk-maintenance-'));
  await rm(root, { recursive: true, force: true });
});
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`new AbortController().signal`）。
 * Result: Return the branch-computed value (`new AbortController().signal`).
 */
const signal = () => new AbortController().signal;
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `machines, id, source, engine, calls`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, id, source, engine, calls`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `machines.records.set`, `createSchema.parse`, `new Date().toISOString`.
 */
async function fixture() {
  const calls: string[][] = [];
  const engine: any = {
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
     * 输入 / Inputs: _tool: string; args: string[]。
     * 结果：返回分支计算值（`''`），以 Promise 交付。
     * Result: Return the branch-computed value (`''`) through a Promise.
     * 协作入口 / Collaborators: `calls.push`, `writeFile`, `args.at`.
     */
    run: async (_tool: string, args: string[]) => {
      calls.push(args);
      if (args[0] === 'convert') await writeFile(args.at(-1)!, 'verified replacement');
      return '';
    },
  };
  const machines = new Machines(engine, fakeVmNetwork),
    id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'disk-test', hardware: { devices: { discard: true } } }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  await mkdir(vmDir(id), { recursive: true });
  const source = join(vmDir(id), 'disk.qcow2');
  await writeFile(source, 'original bytes');
  return { machines, id, source, engine, calls };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: compaction holds the lifecycle lock until publication and cancellation preserves the original disk
 * 状态影响 / State effects: `engine.run`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `runDiskMaintenance`, `assert.rejects`, `machines.start`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, /cancelled/)`; `assert.rejects(machines.start(id), /另一项操作/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('compaction holds the lifecycle lock until publication and cancellation preserves the original disk', async () => {
  const { machines, id, source, engine } = await fixture();
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const converting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  engine.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _tool: string; args: string[]; { signal }: { signal: AbortSignal }。
   * 结果：返回分支计算值（`''`），以 Promise 交付。
   * Result: Return the branch-computed value (`''`) through a Promise.
   * 验证场景 / Scenario: compaction holds the lifecycle lock until publication and cancellation preserves the original disk
   * 协作入口 / Collaborators: `writeFile`, `args.at`, `entered`, `signal.throwIfAborted`.
   */
  async (_tool: string, args: string[], { signal }: { signal: AbortSignal }) => {
    if (args[0] === 'convert') {
      await writeFile(args.at(-1)!, 'partial');
      entered();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      signal.throwIfAborted();
    }
    return '';
  };
  const abort = new AbortController(),
    pending = runDiskMaintenance(machines, id, 'compact', abort.signal);
  const rejected = assert.rejects(pending, /cancelled/);
  await converting;
  await assert.rejects(machines.start(id), /另一项操作/);
  await assert.rejects(saveDiskMaintenancePolicy(machines, id, {}), /另一项操作/);
  assert.equal(await readFile(source, 'utf8'), 'original bytes');
  abort.abort(new Error('cancelled'));
  await rejected;
  assert.equal(await readFile(source, 'utf8'), 'original bytes');
  assert.ok(!(await readdir(vmDir(id))).some((name) => name.includes('compact')));
  assert.equal(machines.isBusy(id), false);
  const state = await diskMaintenanceState(id);
  assert.match(state.attempts.compact!.error!, /cancelled/);
  assert.equal(state.successes.compact, undefined);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed image comparison cannot replace the source and successful compaction verifies before publishing
 * 状态影响 / State effects: `engine.run`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `runDiskMaintenance`, `signal`.
 * 检查边界 / Checked boundaries: `assert.rejects(runDiskMaintenance(machines, id, 'compact', signal()), /different disk contents/)`; `assert.equal(await readFile(source, 'utf8'), 'original bytes')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('failed image comparison cannot replace the source and successful compaction verifies before publishing', async () => {
  const { machines, id, source, engine, calls } = await fixture();
  const original = engine.run;
  engine.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args: any[]。
   * 结果：返回分支计算值（`original(...args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`original(...args)`) through a Promise.
   * 验证场景 / Scenario: failed image comparison cannot replace the source and successful compaction verifies before publishing
   * 失败 / Failure: `new Error('different disk contents')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `original`.
   */
  async (...args: any[]) => {
    if (args[1][0] === 'compare') throw new Error('different disk contents');
    return original(...args);
  };
  await assert.rejects(runDiskMaintenance(machines, id, 'compact', signal()), /different disk contents/);
  assert.equal(await readFile(source, 'utf8'), 'original bytes');
  engine.run = original;
  await runDiskMaintenance(machines, id, 'compact', signal());
  assert.equal(await readFile(source, 'utf8'), 'verified replacement');
  assert.deepEqual(
    calls.slice(-4).map((args) => args[0]),
    ['check', 'convert', 'check', 'compare'],
  );
  assert.ok(calls.some((args) => args[0] === 'convert' && args.includes('-c')));
  assert.ok((await diskMaintenanceState(id)).successes.compact);
  assert.ok(!(await readdir(vmDir(id))).some((name) => name.includes('compact')));
  await writeFile(join(vmDir(id), 'disk.qcow2.before-compact'), 'recovery');
  await assert.rejects(runDiskMaintenance(machines, id, 'compact', signal()), /上次整理/);
  assert.equal(await readFile(join(vmDir(id), 'disk.qcow2.before-compact'), 'utf8'), 'recovery');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: scheduled maintenance persists separate TRIM/compact intervals and respects windows, snapshots and restart
 * 状态影响 / State effects: `machines.get(id).pendingResize`, `maintenance`, `state.attempts.trim`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `Date.now`, `saveDiskMaintenancePolicy`, `saveMaintenancePolicy`.
 * 检查边界 / Checked boundaries: `assert.equal(calls.length, 0)`; `assert.equal(calls.length, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('scheduled maintenance persists separate TRIM/compact intervals and respects windows, snapshots and restart', async () => {
  const { machines, id, calls } = await fixture();
  const now = Date.now();
  await saveDiskMaintenancePolicy(machines, id, { enabled: true, intervalHours: 24 });
  let maintenance = new Maintenance(machines);
  try {
    await saveMaintenancePolicy(id, {
      enabled: true,
      windows: [{ days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'UTC', start: '00:00', end: '00:00' }],
    });
    await maintenance.tick(now);
    assert.equal(calls.length, 0);
    await saveMaintenancePolicy(id, { enabled: false, windows: [] });
    machines.get(id).pendingResize = true;
    await maintenance.tick(now);
    assert.equal(calls.length, 0);
    machines.get(id).pendingResize = false;
    await maintenance.tick(now);
    await maintenance.jobs.wait(id);
    assert.equal(maintenance.jobs.view(id)!.status, 'done');
    const count = calls.length;
    await maintenance.close();
    maintenance = new Maintenance(machines);
    await maintenance.tick(now + 3600000);
    assert.equal(calls.length, count);
    const state = await diskMaintenanceState(id);
    assert.equal(diskMaintenanceDue(state, 'stopped', now + 3600000), null);
    assert.equal(diskMaintenanceDue(state, 'running', now + 3600000), 'trim');
    state.attempts.trim = { startedAt: new Date(now).toISOString(), error: 'failed' };
    assert.equal(diskMaintenanceDue(state, 'running', now + 60000), null);
    assert.equal(diskMaintenanceDue(state, 'running', now + 300001), 'trim');
  } finally {
    await maintenance.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: TRIM checks discard and propagates guest failures without recording a successful run
 * 状态影响 / State effects: `machines.get(id).hardware!.devices!.discard`, `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `machines.get`, `assert.rejects`, `saveDiskMaintenancePolicy`.
 * 检查边界 / Checked boundaries: `assert.rejects(saveDiskMaintenancePolicy(machines, id, { enabled: true }), /discard/)`; `assert.rejects(runDiskMaintenance(machines, id, 'trim', signal()), /运行中的实例/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('TRIM checks discard and propagates guest failures without recording a successful run', async () => {
  const { machines, id } = await fixture();
  machines.get(id).hardware!.devices!.discard = false;
  await assert.rejects(saveDiskMaintenancePolicy(machines, id, { enabled: true }), /discard/);
  await assert.rejects(runDiskMaintenance(machines, id, 'trim', signal()), /运行中的实例/);
  machines.live.set(id, { status: 'running' } as any);
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ code: 1, stdout: '', stderr: 'TRIM is not supported' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 1, stdout: '', stderr: 'TRIM is not supported' })`) through a Promise.
   * 验证场景 / Scenario: TRIM checks discard and propagates guest failures without recording a successful run
   */
  async () => ({ code: 1, stdout: '', stderr: 'TRIM is not supported' });
  await assert.rejects(runDiskMaintenance(machines, id, 'trim', signal()), /discard/);
  machines.get(id).hardware!.devices!.discard = true;
  await assert.rejects(runDiskMaintenance(machines, id, 'trim', signal()), /TRIM is not supported/);
  assert.equal((await diskMaintenanceState(id)).successes.trim, undefined);
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ code: 0, stdout: '/: 1234 bytes trimmed', stderr: '' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 0, stdout: '/: 1234 bytes trimmed', stderr: '' })`) through a Promise.
   * 验证场景 / Scenario: TRIM checks discard and propagates guest failures without recording a successful run
   */
  async () => ({ code: 0, stdout: '/: 1234 bytes trimmed', stderr: '' });
  await runDiskMaintenance(machines, id, 'trim', signal());
  assert.ok((await diskMaintenanceState(id)).successes.trim);
  machines.live.delete(id);
});
