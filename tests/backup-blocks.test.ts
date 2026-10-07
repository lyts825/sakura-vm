/**
 * 模块职责：回归验证模块，围绕 `backup-blocks` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `backup-blocks`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: content blocks deduplicate across machines, survive restart and reconstruct an identical portable file; corrupted chunks, mismatched manifests and cancellation cannot publish or restore an unverified backup.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { Machines as MachinesType } from '../server/machines.ts';
import type { Bundles } from '../server/bundles.ts';
const root = await mkdtemp(join(tmpdir(), 'sakura-backup-blocks-'));
process.env.SAKURA_DATA_DIR = root;
const { BackupBlocks, backupBlocks } = await import('../server/backup-blocks.ts');
const { Backups } = await import('../server/backups.ts');
const { Machines } = await import('../server/machines.ts');
after(() => rm(root, { recursive: true, force: true }));
/**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: bytes: Buffer。
 * 结果：返回分支计算值（`createHash('sha256').update(bytes).digest('hex')`）。
 * Result: Return the branch-computed value (`createHash('sha256').update(bytes).digest('hex')`).
 * 协作入口 / Collaborators: `createHash('sha256').update(bytes).digest`, `createHash('sha256').update`, `createHash`.
 */
const checksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const signal = new AbortController().signal;
const bytes = Buffer.concat([Buffer.alloc(1024 ** 2, 1), Buffer.alloc(1024 ** 2, 2), Buffer.alloc(700, 3)]);
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `output, value`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `output, value`; the actual branch determines its shape.
 */
function sink() {
  const chunks: Buffer[] = [];
  return {
    output: new Writable({
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: chunk; _encoding; cb。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `chunks.push`, `Buffer.from`, `cb`.
       */
      write(chunk, _encoding, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`Buffer.concat(chunks)`）。
     * Result: Return the branch-computed value (`Buffer.concat(chunks)`).
     * 协作入口 / Collaborators: `Buffer.concat`.
     */
    value: () => Buffer.concat(chunks),
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: content blocks deduplicate across machines, survive restart and reconstruct an identical portable file
 * 协作入口 / Collaborators: `join`, `randomUUID`, `writeFile`, `store.pack`.
 * 检查边界 / Checked boundaries: `assert.equal(stats.backups, 2)`; `assert.equal(stats.physicalBytes, bytes.length)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('content blocks deduplicate across machines, survive restart and reconstruct an identical portable file', async () => {
  const directory = join(root, 'shared'),
    store = new BackupBlocks(directory),
    vm = randomUUID(),
    peer = randomUUID();
  const a = randomUUID(),
    b = randomUUID(),
    source = join(root, 'source');
  await writeFile(source, bytes);
  await store.pack(vm, a, source, checksum(bytes), signal);
  await store.pack(peer, b, source, checksum(bytes), signal);
  const loaded = new BackupBlocks(directory),
    stats = await loaded.inspect();
  assert.equal(stats.backups, 2);
  assert.equal(stats.physicalBytes, bytes.length);
  assert.equal(stats.savedBytes, bytes.length);
  const result = sink();
  await loaded.writeTo(vm, a, checksum(bytes), result.output, signal);
  assert.deepEqual(result.value(), bytes);
  await loaded.withFile(peer, b, checksum(bytes), signal, async (path) =>
    assert.deepEqual(await readFile(path), bytes),
  );
  assert.deepEqual(await readdir(join(directory, 'materialized')), []);
  await loaded.remove(vm, a);
  assert.equal((await loaded.inspect(true)).reclaimedBytes, 0);
  await loaded.remove(peer, b);
  assert.equal((await loaded.inspect(true)).reclaimedBytes, bytes.length);
  assert.equal((await loaded.inspect()).physicalBytes, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: corrupted chunks, mismatched manifests and cancellation cannot publish or restore an unverified backup
 * 协作入口 / Collaborators: `join`, `randomUUID`, `writeFile`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(store.pack(vm, randomUUID(), source, checksum(bytes), AbortSignal.abort()))`; `assert.equal((await store.inspect()).backups, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('corrupted chunks, mismatched manifests and cancellation cannot publish or restore an unverified backup', async () => {
  const directory = join(root, 'damaged'),
    store = new BackupBlocks(directory),
    vm = randomUUID(),
    id = randomUUID();
  const source = join(root, 'damaged-source');
  await writeFile(source, bytes);
  await assert.rejects(store.pack(vm, randomUUID(), source, checksum(bytes), AbortSignal.abort()));
  assert.equal((await store.inspect()).backups, 0);
  const manifest = await store.pack(vm, id, source, checksum(bytes), signal);
  await assert.rejects(store.read(vm, id, 'a'.repeat(64)), /不符/);
  const first = manifest.chunks[0].sha256;
  await writeFile(join(directory, 'chunks', first.slice(0, 2), first), Buffer.alloc(1024 ** 2, 9));
  await assert.rejects(
    store.withFile(vm, id, checksum(bytes), signal, async () =>
      assert.fail('must not expose corrupt backup'),
    ),
    /校验失败/,
  );
  await assert.rejects(store.pack(vm, randomUUID(), source, checksum(bytes), signal), /损坏/);
  assert.deepEqual(await readdir(join(directory, 'materialized')), []);
  await rm(join(directory, 'chunks', first.slice(0, 2), first));
  await assert.rejects(store.inspect(true), /缺失/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: deletion and garbage collection wait until an active reconstruction releases its blocks
 * 协作入口 / Collaborators: `join`, `randomUUID`, `writeFile`, `store.pack`.
 * 检查边界 / Checked boundaries: `assert.rejects(waiting, { name: 'AbortError' })`; `assert.equal(removed, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('deletion and garbage collection wait until an active reconstruction releases its blocks', async () => {
  const store = new BackupBlocks(join(root, 'concurrent')),
    vm = randomUUID(),
    id = randomUUID();
  const source = join(root, 'concurrent-source');
  await writeFile(source, bytes);
  await store.pack(vm, id, source, checksum(bytes), signal);
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void,
    started!: /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void,
    held = false,
    removed = false;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const output = new Writable({
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _chunk; _encoding; cb。
     * 结果：返回分支计算值（`cb()`）。
     * Result: Return the branch-computed value (`cb()`).
     * 验证场景 / Scenario: deletion and garbage collection wait until an active reconstruction releases its blocks
     * 状态影响 / State effects: `held`, `release`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `cb`, `started`.
     */
    write(_chunk, _encoding, cb) {
      if (held) return cb();
      held = true;
      release = /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`cb()`）。
       * Result: Return the branch-computed value (`cb()`).
       * 验证场景 / Scenario: deletion and garbage collection wait until an active reconstruction releases its blocks
       * 协作入口 / Collaborators: `cb`.
       */
      () => cb();
      started();
    },
  });
  const downloading = store.writeTo(vm, id, checksum(bytes), output, signal);
  await ready;
  const removing = store.remove(vm, id).then(() => {
    removed = true;
  });
  const collecting = store.inspect(true);
  const abort = new AbortController();
  const waiting = store.pack(vm, randomUUID(), source, checksum(bytes), abort.signal);
  abort.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  await delay(20);
  assert.equal(removed, false);
  release();
  await downloading;
  await removing;
  assert.equal((await collecting).physicalBytes, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: backup policy stores blocks, verifies and restores them, preserves retention and never silently downgrades encryption
 * 状态影响 / State effects: `machines.get`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `Buffer.alloc`, `Buffer.from`, `JSON.stringify`.
 * 检查边界 / Checked boundaries: `assert.rejects(backups.run(vm, 'long-test-password'), /加密/)`; `assert.rejects(backups.policy(vm, { deduplicate: true, directory: root }), /本机未加密/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('backup policy stores blocks, verifies and restores them, preserves retention and never silently downgrades encryption', async () => {
  const vm = randomUUID(),
    machines = new Machines({} as any, fakeVmNetwork);
  machines.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id: vm, name: 'dedup' }) as ReturnType<MachinesType['get']>`）。
   * Result: Return the branch-computed value (`({ id: vm, name: 'dedup' }) as ReturnType<MachinesType['get']>`).
   * 验证场景 / Scenario: backup policy stores blocks, verifies and restores them, preserves retention and never silently downgrades encryption
   */
  () => ({ id: vm, name: 'dedup' }) as ReturnType<MachinesType['get']>;
  const disk = Buffer.alloc(3 * 1024 ** 2, 7),
    manifest = Buffer.from(JSON.stringify({ sha256: checksum(disk) })),
    size = Buffer.alloc(4);
  size.writeUInt32BE(manifest.length);
  const bundle = Buffer.concat([Buffer.from('SAKURA01'), size, manifest, disk]);
  let imports = 0;
  const bundles = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; _signal: AbortSignal; work: any。
     * 结果：返回分支计算值（`work(disk.length, (output: Writable) => pipeline(Readable.from([bundle]), output…`），以 Promise 交付。
     * Result: Return the branch-computed value (`work(disk.length, (output: Writable) => pipeline(Readable.from([bundle]), output…`) through a Promise.
     * 验证场景 / Scenario: backup policy stores blocks, verifies and restores them, preserves retention and never silently downgrades encryption
     * 协作入口 / Collaborators: `work`.
     */
    withExportBudget: async (_id: string, _signal: AbortSignal, work: any) =>
      work(disk.length, (output: Writable) => pipeline(Readable.from([bundle]), output)),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; output: Writable。
     * 结果：返回分支计算值（`pipeline(Readable.from([bundle]), output)`），以 Promise 交付。
     * Result: Return the branch-computed value (`pipeline(Readable.from([bundle]), output)`) through a Promise.
     * 验证场景 / Scenario: backup policy stores blocks, verifies and restores them, preserves retention and never silently downgrades encryption
     * 协作入口 / Collaborators: `pipeline`, `Readable.from`.
     */
    export: async (_id: string, output: Writable) => pipeline(Readable.from([bundle]), output),
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _name: string; input: Readable。
     * 结果：返回受控对象，公开字段包括 `name`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `name`; the actual branch determines its shape.
     * 验证场景 / Scenario: backup policy stores blocks, verifies and restores them, preserves retention and never silently downgrades encryption
     * 协作入口 / Collaborators: `chunks.push`, `assert.deepEqual`, `Buffer.concat`.
     * 检查边界 / Checked boundaries: `assert.deepEqual(Buffer.concat(chunks), bundle)`.
     */
    import: async (_name: string, input: Readable) => {
      const chunks = [];
      for await (const chunk of input) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), bundle);
      imports++;
      return { name: 'restored' };
    },
  } as unknown as Bundles;
  const backups = new Backups(machines, bundles);
  try {
    await backups.policy(vm, { deduplicate: true, lockDays: 1 });
    await assert.rejects(backups.run(vm, 'long-test-password'), /加密/);
    await assert.rejects(backups.policy(vm, { deduplicate: true, directory: root }), /本机未加密/);
    const job = await backups.run(vm);
    await backups.jobs.wait(vm);
    assert.equal(job.status, 'done', job.error);
    const item = (await backups.view(vm)).items[0];
    assert.equal(item.storage, 'blocks');
    await assert.rejects(backups.operate(vm, item.id, 'delete'), { code: 'BACKUP_LOCKED' });
    const download = await backups.downloadable(vm, item.id);
    assert.equal(download.type, 'stream');
    const downloaded = sink();
    await download.write(downloaded.output, signal);
    assert.deepEqual(downloaded.value(), bundle);
    await backups.operate(vm, item.id, 'restore', 'restored');
    await backups.jobs.wait(vm);
    assert.equal(backups.jobs.view(vm)?.status, 'done', backups.jobs.view(vm)?.error);
    assert.equal(imports, 1);
    assert.equal((await backupBlocks().inspect()).backups, 1);
  } finally {
    await backups.close();
  }
});
