/**
 * 模块职责：回归验证模块，围绕 `machines-save` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `machines-save`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: machine saves publish admission-time nested snapshots in order and close drains the pending publication; a sustained own Windows read handle preserves the complete machine list, reports failure and permits a later queued save after clo….
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Machines as MachineType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';
import type { VMRecord } from '../server/model.ts';

const base = resolve('.data/machines-save-test-temp');
await fs.mkdir(base, { recursive: true });
assert.equal(await fs.realpath(base), base);
assert.equal((await fs.lstat(base)).isSymbolicLink(), false);
const root = await fs.mkdtemp(join(base, 'machines-save-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { DATA, createSchema } = await import('../server/model.ts');
assert.equal(DATA, root);
const file = join(root, 'machines.json'), sentinelFile = file + '.tmp';
const sentinel = 'an unrelated pre-existing owned temporary file';
const originalRename = fs.rename, originalWriteFile = fs.writeFile;
after(async () => {
  assert.equal(dirname(resolve(root)), base);
  assert.equal(await fs.realpath(root), root);
  assert.equal((await fs.lstat(root)).isSymbolicLink(), false);
  assert.ok(basename(root).startsWith('machines-save-'));
  await fs.rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, release`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, release`; the actual branch determines its shape.
 */
function gate() {
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const promise = new Promise<void>(yes => { release = yes; });
  return { promise, release };
}
/**
 * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
 * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
 * 输入 / Inputs: machines: MachineType。
 * 结果：返回分支计算值（`(machines as unknown as { save(): Promise<void> }).save()`）。
 * Result: Return the branch-computed value (`(machines as unknown as { save(): Promise<void> }).save()`).
 * 协作入口 / Collaborators: `(machines as unknown as { save(): Promise<void> }).save`.
 */
const save = (machines: MachineType) => (machines as unknown as { /**
 * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
 * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
save(): Promise<void> }).save();
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `machines, record, old, closes`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, record, old, closes`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `createSchema.parse`, `randomUUID`, `new Date().toISOString`, `machines.records.set`.
 */
async function fixture() {
  let closes = 0;
  const machines = new Machines({ runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  close: async () => { ++closes; } } } as unknown as Engine, fakeVmNetwork);
  const record: VMRecord = { ...createSchema.parse({ name: 'old-owned',
    forwards: [{ name: 'old-nested', host: 24601, guest: 24602 }] }),
    id: randomUUID(), createdAt: new Date().toISOString(), snapshots: [], bootstrapped: true };
  machines.records.set(record.id, record);
  const old = JSON.stringify([record], null, 2);
  await originalWriteFile(file, old);
  await originalWriteFile(sentinelFile, sentinel);
  return { machines, record, old, /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`closes`）。
   * Result: Return the branch-computed value (`closes`).
   */
  closes: () => closes };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: machine saves publish admission-time nested snapshots in order and close drains the pending publication
 * 状态影响 / State effects: `f.record.name`, `f.record.forwards[0].name`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `gate`, `t.mock.method`, `syncBuiltinESMExports`.
 * 检查边界 / Checked boundaries: `assert.equal(sources.size, 1)`; `assert.equal(writes, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('machine saves publish admission-time nested snapshots in order and close drains the pending publication', async t => {
  const f = await fixture(), reached = [gate(), gate()], allowed = [gate(), gate()];
  const sources = new Map<string, number>(), published: VMRecord[][] = [];
  const operations: Promise<void>[] = [];
  let writes = 0;
  try {
    t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
      if (String(args[0]).startsWith(file + '.')) {
        ++writes;
        assert.deepEqual(args[2], { mode: 0o600, flag: 'wx', flush: true });
        assert.notEqual(String(args[0]), sentinelFile);
      }
      return originalWriteFile(...args);
    });
    t.mock.method(fs, 'rename', /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: source: string; destination: string。
     * 结果：返回分支计算值（`originalRename(source, destination)`），以 Promise 交付。
     * Result: Return the branch-computed value (`originalRename(source, destination)`) through a Promise.
     * 验证场景 / Scenario: machine saves publish admission-time nested snapshots in order and close drains the pending publication
     * 状态影响 / State effects: `index`, `published[index]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.equal`, `sources.get`, `sources.set`, `assert.ok`.
     * 检查边界 / Checked boundaries: `assert.equal(destination, file)`; `assert.ok(source.startsWith(file + '.') && source.endsWith('.tmp'))`.
     */
    async (source: string, destination: string) => {
      assert.equal(destination, file);
      let index = sources.get(source);
      if (index === undefined) {
        index = sources.size; sources.set(source, index);
        assert.ok(source.startsWith(file + '.') && source.endsWith('.tmp'));
        assert.notEqual(source, sentinelFile);
        published[index] = JSON.parse(await fs.readFile(source, 'utf8')) as VMRecord[];
        reached[index].release();
        await allowed[index].promise;
      }
      return originalRename(source, destination);
    });
    syncBuiltinESMExports();
    f.record.name = 'first-owned'; f.record.forwards[0].name = 'first-nested';
    operations.push(save(f.machines)); void operations[0].catch(() => {});
    await reached[0].promise;
    f.record.name = 'second-owned'; f.record.forwards[0].name = 'second-nested';
    operations.push(save(f.machines)); void operations[1].catch(() => {});
    f.record.name = 'not-yet-saved'; f.record.forwards[0].name = 'not-yet-saved-nested';
    await delay(15);
    assert.equal(sources.size, 1); assert.equal(writes, 1);
    assert.equal(await fs.readFile(file, 'utf8'), f.old);
    allowed[0].release(); await operations[0]; await reached[1].promise;
    const first = JSON.parse(await fs.readFile(file, 'utf8')) as VMRecord[];
    assert.equal(first[0].name, 'first-owned'); assert.equal(first[0].forwards[0].name, 'first-nested');
    const closing = f.machines.close();
    await delay(15); assert.equal(f.closes(), 0);
    allowed[1].release(); await operations[1]; await closing;
    const next = JSON.parse(await fs.readFile(file, 'utf8')) as VMRecord[];
    assert.equal(next[0].name, 'second-owned'); assert.equal(next[0].forwards[0].name, 'second-nested');
    assert.equal(published[0][0].name, 'first-owned'); assert.equal(published[1][0].name, 'second-owned');
    assert.equal(writes, 2); assert.equal(sources.size, 2); assert.equal(f.closes(), 1);
    assert.equal(await fs.readFile(sentinelFile, 'utf8'), sentinel);
    assert.deepEqual((await fs.readdir(root)).sort(), [basename(file), basename(sentinelFile)].sort());
  } finally {
    for (const item of allowed) item.release();
    await Promise.allSettled(operations);
    t.mock.restoreAll(); syncBuiltinESMExports(); await f.machines.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a sustained own Windows read handle preserves the complete machine list, reports failure and permits a later queued save after close
 * 状态影响 / State effects: `handle`, `f.record.name`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `fs.open`, `handle.stat`, `performance.now`.
 * 检查边界 / Checked boundaries: `assert.rejects(save(f.machines), error => { failure = error as NodeJS.ErrnoException; assert.ok(['EPERM', 'EACCES', 'EBUSY'].inclu…`; `assert.ok(elapsedMs >= 900 && elapsedMs < 5000, `bounded machine save elapsed ${elapsedMs}ms`)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a sustained own Windows read handle preserves the complete machine list, reports failure and permits a later queued save after close',
  { skip: process.platform !== 'win32' }, async t => {
    const f = await fixture();
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(file, 'r');
      const identity = await handle.stat(), started = performance.now();
      f.record.name = 'new-owned';
      let failure: NodeJS.ErrnoException | undefined;
      await assert.rejects(save(f.machines), error => {
        failure = error as NodeJS.ErrnoException;
        assert.ok(['EPERM', 'EACCES', 'EBUSY'].includes(failure.code || ''));
        assert.equal(failure.syscall, 'rename');
        assert.equal((failure as NodeJS.ErrnoException & { dest: string }).dest, file);
        assert.notEqual(failure.path, sentinelFile);
        return true;
      });
      const elapsedMs = performance.now() - started;
      assert.ok(elapsedMs >= 900 && elapsedMs < 5000, `bounded machine save elapsed ${elapsedMs}ms`);
      assert.equal(await fs.readFile(file, 'utf8'), f.old);
      const retained = await fs.stat(file);
      assert.equal(retained.dev, identity.dev); assert.equal(retained.ino, identity.ino);
      assert.equal(await fs.readFile(sentinelFile, 'utf8'), sentinel);
      assert.deepEqual((await fs.readdir(root)).sort(), [basename(file), basename(sentinelFile)].sort());
      await handle.close(); handle = undefined;
      await save(f.machines);
      assert.equal((JSON.parse(await fs.readFile(file, 'utf8')) as VMRecord[])[0].name, 'new-owned');
      assert.equal(await fs.readFile(sentinelFile, 'utf8'), sentinel);
      assert.deepEqual((await fs.readdir(root)).sort(), [basename(file), basename(sentinelFile)].sort());
      t.diagnostic(JSON.stringify({ ownNativeReadHandle: true, elapsedMs: Math.round(elapsedMs), code: failure!.code,
        retainedDevice: identity.dev, retainedInode: identity.ino, recoveryAfterClose: true }));
    } finally { await handle?.close(); await f.machines.close(); }
  });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a non-retry machine publication error is preserved and does not poison a later save or modify another temporary file
 * 状态影响 / State effects: `f.record.name`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `Object.assign`, `t.mock.method`, `syncBuiltinESMExports`.
 * 检查边界 / Checked boundaries: `assert.rejects(save(f.machines), error => error === failure)`; `assert.equal(attempts, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a non-retry machine publication error is preserved and does not poison a later save or modify another temporary file', async t => {
  const f = await fixture(), failure = Object.assign(new Error('owned machine publication failure'), { code: 'EIO' });
  let attempts = 0;
  try {
    t.mock.method(fs, 'rename', async () => { ++attempts; throw failure; }); syncBuiltinESMExports();
    f.record.name = 'failed-owned';
    await assert.rejects(save(f.machines), error => error === failure);
    assert.equal(attempts, 1);
    assert.equal(await fs.readFile(file, 'utf8'), f.old);
    assert.equal(await fs.readFile(sentinelFile, 'utf8'), sentinel);
    assert.deepEqual((await fs.readdir(root)).sort(), [basename(file), basename(sentinelFile)].sort());
    t.mock.restoreAll(); syncBuiltinESMExports();
    f.record.name = 'recovered-owned'; await save(f.machines);
    assert.equal((JSON.parse(await fs.readFile(file, 'utf8')) as VMRecord[])[0].name, 'recovered-owned');
    assert.equal(await fs.readFile(sentinelFile, 'utf8'), sentinel);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.machines.close(); }
});
