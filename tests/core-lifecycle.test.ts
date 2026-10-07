/**
 * 模块职责：回归验证模块，围绕 `core-lifecycle` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `core-lifecycle`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: closing waits for an admitted launch before releasing the runtime; boot circuit persists failed launches across controller restarts and explicitly resets.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs, { mkdtemp, mkdir, rm, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-core-lifecycle-'));
const originalWriteFile = fs.writeFile, originalRename = fs.rename;
const machineFile = join(root, 'machines.json');
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: path: unknown。
 * 结果：返回分支计算值（`typeof path === 'string' && dirname(path) === root && /^machines\.json\.[0-9a-f]…`）。
 * Result: Return the branch-computed value (`typeof path === 'string' && dirname(path) === root && /^machines\.json\.[0-9a-f]…`).
 * 协作入口 / Collaborators: `dirname`, `/^machines\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{…`, `basename`.
 */
const machineTemporary = (path: unknown) => typeof path === 'string' && dirname(path) === root
  && /^machines\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i.test(basename(path));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');

after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.equal(await realpath(root), root);
  assert.equal((await lstat(root)).isSymbolicLink(), false);
  assert.ok(basename(root).startsWith('sakura-core-lifecycle-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext。
 * 结果：返回受控对象，公开字段包括 `machines, id, events, finish`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, id, events, finish`; the actual branch determines its shape.
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `machines.init`, `randomUUID`, `machines.records.set`, `createSchema.parse`.
 */
async function fixture(t: TestContext) {
  const events: string[] = [];
  let finish!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const engine = {
    whpxAvailable: false,
    runtime: { /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`void events.push('close')`），以 Promise 交付。
     * Result: Return the branch-computed value (`void events.push('close')`) through a Promise.
     * 协作入口 / Collaborators: `events.push`.
     */
    close: async () => void events.push('close') },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool; _args; options = {}。
     * 结果：返回分支计算值（`''`），以 Promise 交付。
     * Result: Return the branch-computed value (`''`) through a Promise.
     * 协作入口 / Collaborators: `events.push`.
     */
    run: async (_tool, _args, options = {}) => {
      events.push('launch');
      await new Promise<void>((resolve) => {
        finish = resolve;
        if (options.signal?.aborted) resolve();
        else options.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      events.push('exit');
      return '';
    },
  } as Engine;
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  const id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'lifecycle-test' }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  await mkdir(vmDir(id));
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `command.includes`, `finish`.
   */
  async (_id, command) => {
    if (command.includes('poweroff')) finish();
    return { stdout: '', stderr: '', code: 0 };
  };
  t.after(async () => {
    const running = [...machines.live.values()];
    for (const live of running) live.abort.abort();
    await Promise.allSettled(running.map((live) => live.done));
    await machines.close();
  });
  return { machines, id, events, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`finish()`）。
   * Result: Return the branch-computed value (`finish()`).
   * 协作入口 / Collaborators: `finish`.
   */
  finish: () => finish() };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: closing waits for an admitted launch before releasing the runtime
 * 协作入口 / Collaborators: `fixture`, `machines.start`, `machines.close`, `Promise.all`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(events, ['launch', 'exit', 'close'])`; `assert.equal(machines.live.size, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('closing waits for an admitted launch before releasing the runtime', async (t) => {
  const { machines, id, events } = await fixture(t);
  const starting = machines.start(id);
  const closing = machines.close();
  await Promise.all([starting, closing]);
  assert.deepEqual(events, ['launch', 'exit', 'close']);
  assert.equal(machines.live.size, 0);
  await assert.rejects(machines.start(id), /关闭/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: boot circuit persists failed launches across controller restarts and explicitly resets
 * 状态影响 / State effects: `machines.exec`, `machines.engine.run`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `machines.start`, `machines.live.get`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal((await machines.bootGuard(id)).blocked, true)`; `assert.equal((await reloaded.bootGuard(id)).failures, 5)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('boot circuit persists failed launches across controller restarts and explicitly resets', async (t) => {
  const { machines, id } = await fixture(t);
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: boot circuit persists failed launches across controller restarts and explicitly resets
   * 失败 / Failure: `new Error('SSH unavailable')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => {
    throw new Error('SSH unavailable');
  };
  machines.engine.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: boot circuit persists failed launches across controller restarts and explicitly resets
   * 失败 / Failure: `new Error('QEMU failed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => {
    throw new Error('QEMU failed');
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    await machines.start(id);
    await machines.live.get(id)?.done;
  }
  assert.equal((await machines.bootGuard(id)).blocked, true);
  const reloaded = new Machines(machines.engine, fakeVmNetwork);
  await reloaded.init();
  t.after(() => reloaded.close());
  assert.equal((await reloaded.bootGuard(id)).failures, 5);
  await assert.rejects(reloaded.start(id), { code: 'BOOT_CIRCUIT_OPEN' });
  await reloaded.bootGuard(id, true);
  assert.equal((await reloaded.bootGuard(id)).blocked, false);
  await reloaded.start(id);
  await reloaded.live.get(id)?.done;
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: closing waits for existing disk operations and rejects new work
 * 协作入口 / Collaborators: `fixture`, `machines.locked`, `machines.close`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects( machines.locked('other-operation', async () => {}), /关闭/, )`; `assert.deepEqual(events, ['disk-complete', 'close'])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('closing waits for existing disk operations and rejects new work', async (t) => {
  const { machines, events } = await fixture(t);
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const pending = machines.locked('disk-operation', async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    events.push('disk-complete');
  });
  const closing = machines.close();
  await assert.rejects(
    machines.locked('other-operation', async () => {}),
    /关闭/,
  );
  release();
  await Promise.all([pending, closing]);
  assert.deepEqual(events, ['disk-complete', 'close']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed startup persistence does not leave an unkillable powered-on instance
 * 状态影响 / State effects: `machines.get(id).lastError`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `machines.get`, `JSON.stringify`, `machines.records.values`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.start(id), error => error === failure)`; `assert.equal(writes, 1, 'non-retry EIO is injected once into this exact machine-list write')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('failed startup persistence does not leave an unkillable powered-on instance', async (t) => {
  const { machines, id, events } = await fixture(t);
  machines.get(id).lastError = 'previous boot failure';
  const old = JSON.stringify([...machines.records.values()], null, 2);
  const neighbor = join(root, `lifecycle-neighbor-${id}.tmp`), sentinel = 'another owned file';
  await writeFile(machineFile, old);
  await writeFile(neighbor, sentinel);
  const failure = Object.assign(new Error('owned startup machine-list write failure'), { code: 'EIO' });
  let writes = 0, temporary: string | undefined;
  try {
    t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
      if (machineTemporary(args[0])) {
        ++writes;
        temporary = String(args[0]);
        assert.deepEqual(args[2], { mode: 0o600, flag: 'wx', flush: true });
        assert.equal(JSON.parse(String(args[1])).find((record: { id: string }) => record.id === id).lastError, undefined);
        throw failure;
      }
      return originalWriteFile(...args);
    });
    syncBuiltinESMExports();
    await assert.rejects(machines.start(id), error => error === failure);
    assert.equal(writes, 1, 'non-retry EIO is injected once into this exact machine-list write');
    assert.ok(temporary && machineTemporary(temporary));
    await assert.rejects(lstat(temporary), { code: 'ENOENT' });
    assert.equal(await readFile(machineFile, 'utf8'), old);
    assert.equal(await readFile(neighbor, 'utf8'), sentinel);
    assert.deepEqual(events, []);
    assert.equal(machines.live.has(id), false);
    assert.equal(machines.state(id), 'error');
    assert.equal(machines.get(id).lastError, 'previous boot failure');
    t.diagnostic(JSON.stringify({ ownedFailure: failure.message, code: failure.code, injectedWrites: writes,
      temporaryCleaned: true, oldSha256: createHash('sha256').update(old).digest('hex'), neighborUnchanged: true }));
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a persistence failure after process exit still completes cleanup and emits state
 * 协作入口 / Collaborators: `fixture`, `machines.start`, `machines.live.get`, `machines.once`.
 * 检查边界 / Checked boundaries: `assert.doesNotReject(live.done)`; `assert.equal(publications, 1, 'non-retry EIO is injected once into this exact machine-list publication')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a persistence failure after process exit still completes cleanup and emits state', async (t) => {
  const { machines, id, finish, events } = await fixture(t);
  await machines.start(id);
  const live = machines.live.get(id)!;
  let changed = false;
  machines.once('change', () => {
    changed = true;
  });
  const old = await readFile(machineFile, 'utf8');
  const neighbor = join(root, `lifecycle-neighbor-${id}.tmp`), sentinel = 'another owned file';
  await writeFile(neighbor, sentinel);
  const failure = Object.assign(new Error('owned exited machine-list publication failure'), { code: 'EIO' });
  let publications = 0, temporary: string | undefined;
  try {
    t.mock.method(fs, 'rename', async (source: Parameters<typeof fs.rename>[0], destination: Parameters<typeof fs.rename>[1]) => {
      if (destination === machineFile && machineTemporary(source)) {
        ++publications;
        temporary = String(source);
        assert.ok(JSON.parse(await readFile(temporary, 'utf8')).some((record: { id: string }) => record.id === id));
        throw failure;
      }
      return originalRename(source, destination);
    });
    syncBuiltinESMExports();
    const done = assert.doesNotReject(live.done);
    finish();
    await done;
    assert.equal(publications, 1, 'non-retry EIO is injected once into this exact machine-list publication');
    assert.ok(temporary && machineTemporary(temporary));
    await assert.rejects(lstat(temporary), { code: 'ENOENT' });
    assert.equal(await readFile(machineFile, 'utf8'), old);
    assert.equal(await readFile(neighbor, 'utf8'), sentinel);
    assert.deepEqual(events, ['launch', 'exit']);
    assert.equal(live.bootAbort.signal.aborted, true);
    assert.equal(machines.live.has(id), false);
    assert.equal(changed, true);
    assert.ok((machines.logs.get(id) || '').includes(`保存实例状态失败：${String(failure)}`));
    t.diagnostic(JSON.stringify({ ownedFailure: failure.message, code: failure.code, injectedPublications: publications,
      temporaryCleaned: true, oldSha256: createHash('sha256').update(old).digest('hex'), neighborUnchanged: true }));
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
  }
});
