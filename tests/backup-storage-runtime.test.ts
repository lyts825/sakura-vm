/**
 * 模块职责：回归验证模块，围绕 `backup-storage-runtime` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `backup-storage-runtime`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: a real 128 GiB sparse QCOW2 backup fits a 64 MiB free-space budget and retains its VM lock while queued; real sparse LUKS QCOW2 measurement uses the encrypted output format before backup admission.
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { createSchema } from '../shared/contracts/vm.ts';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { StorageRuntime, type StorageLease } from '../server/storage-runtime.ts';
import type { Machines } from '../server/machines.ts';
import { metadataFile } from '../server/metadata-store.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-storage-budget-'));
process.env.SAKURA_DATA_DIR = root;
const { Backups, backupPolicySchema } = await import('../server/backups.ts');
const { Bundles } = await import('../server/bundles.ts');
const { backupBlocks } = await import('../server/backup-blocks.ts');
const { vmDir } = await import('../server/paths.ts');
const { qemuSecretObject } = await import('../server/disk-encryption.ts');
const binary = resolve(
  process.env.SAKURA_QEMU_DIR || '.tools/qemu',
  process.platform === 'win32' ? 'qemu-img.exe' : 'qemu-img',
);
const execute = promisify(execFile);
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: value: Buffer。
 * 结果：返回分支计算值（`createHash('sha256').update(value).digest('hex')`）。
 * Result: Return the branch-computed value (`createHash('sha256').update(value).digest('hex')`).
 * 协作入口 / Collaborators: `createHash('sha256').update(value).digest`, `createHash('sha256').update`, `createHash`.
 */
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const signal = new AbortController().signal;
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  await rm(root, { recursive: true, force: true });
});
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `id, machines, host, storage, leases, bundles, backups`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, machines, host, storage, leases, bundles, backups`; the actual branch determines its shape.
 * 状态影响 / State effects: `storage.acquire`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `createSchema.parse`, `storage.acquire.bind`.
 */
function fixture() {
  const id = randomUUID(),
    record = { ...createSchema.parse({ name: 'sparse', diskGiB: 128 }), id, snapshots: [] };
  const queues = new Map<string, Promise<unknown>>();
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`record`）。
     * Result: Return the branch-computed value (`record`).
     */
    get: () => record,
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    requireStopped() {},
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    requireUnlocked() {},
    live: new Map(),
    records: new Map([[id, record]]),
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: key: string; work: () => Promise<T>。
     * 结果：返回分支计算值（`result`）。
     * Result: Return the branch-computed value (`result`).
     * 协作入口 / Collaborators: `(queues.get(key) || Promise.resolve()).catch(() => {}).then`, `(queues.get(key) || Promise.resolve()).catch`, `queues.get`, `Promise.resolve`.
     */
    locked<T>(key: string, work: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<T>) {
      const result = (queues.get(key) || Promise.resolve()).catch(() => {}).then(work);
      queues.set(key, result);
      return result;
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ key: 'fixture-private-key', seed: Buffer.alloc(34816) })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ key: 'fixture-private-key', seed: Buffer.alloc(34816) })`) through a Promise.
     * 协作入口 / Collaborators: `Buffer.alloc`.
     */
    snapshotIdentity: async () => ({ key: 'fixture-private-key', seed: Buffer.alloc(34816) }),
    engine: {
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: _tool: string; args: string[]; options: { signal?: AbortSignal } = {}。
       * 结果：返回分支计算值（`(await execute(binary, args, { windowsHide: true, signal: options.signal })).std…`），以 Promise 交付。
       * Result: Return the branch-computed value (`(await execute(binary, args, { windowsHide: true, signal: options.signal })).std…`) through a Promise.
       * 协作入口 / Collaborators: `execute`.
       */
      run: async (_tool: string, args: string[], options: { signal?: AbortSignal } = {}) =>
        (await execute(binary, args, { windowsHide: true, signal: options.signal })).stdout,
    },
  } as unknown as Machines;
  const host = new HostRuntime();
  const leases: StorageLease[] = [];
  const storage = new StorageRuntime(host, async (path) => ({
    key: 'fixture-device',
    path,
    totalBytes: 1024 ** 3,
    freeBytes: 64 * 1024 ** 2,
  }));
  const acquire = storage.acquire.bind(storage);
  storage.acquire = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: request。
   * 结果：返回分支计算值（`lease`），以 Promise 交付。
   * Result: Return the branch-computed value (`lease`) through a Promise.
   * 协作入口 / Collaborators: `acquire`, `leases.push`.
   */
  async (request) => {
    const lease = await acquire(request);
    leases.push(lease);
    return lease;
  };
  const bundles = new Bundles(machines),
    backups = new Backups(machines, bundles, undefined, storage);
  return { id, machines, host, storage, leases, bundles, backups };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a real 128 GiB sparse QCOW2 backup fits a 64 MiB free-space budget and retains its VM lock while queued
 * 状态影响 / State effects: `machines.engine.run`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `mkdir`, `vmDir`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(changed, false, 'The measured source must stay locked while admission waits')`; `assert.equal(job.status, 'done', job.error)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test(
  'a real 128 GiB sparse QCOW2 backup fits a 64 MiB free-space budget and retains its VM lock while queued',
  { skip: !existsSync(binary) },
  async () => {
    const { id, machines, host, storage, backups } = fixture();
    await mkdir(vmDir(id), { recursive: true });
    const base = join(root, id + '.base.qcow2'),
      disk = join(vmDir(id), 'disk.qcow2');
    await execute(binary, ['create', '-f', 'qcow2', base, '128G'], { windowsHide: true });
    await execute(binary, ['create', '-f', 'qcow2', '-F', 'qcow2', '-b', base, disk], { windowsHide: true });
    const gate = await storage.acquire({
      owner: 'test:gate',
      taskId: 'gate',
      label: 'Hold writer',
      mode: 'write',
      paths: [root],
      buffers: 1,
      files: 1,
    });
    let measured!: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void;
    const ready = new Promise<void>((done) => {
      measured = done;
    });
    const run = machines.engine.run.bind(machines.engine);
    machines.engine.run = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args: Parameters<typeof run>。
     * 结果：返回分支计算值（`result`），以 Promise 交付。
     * Result: Return the branch-computed value (`result`) through a Promise.
     * 验证场景 / Scenario: a real 128 GiB sparse QCOW2 backup fits a 64 MiB free-space budget and retains its VM lock while queued
     * 协作入口 / Collaborators: `run`, `measured`.
     */
    async (...args: Parameters<typeof run>) => {
      const result = await run(...args);
      if (args[1][0] === 'measure') measured();
      return result;
    };
    try {
      const job = await backups.run(id);
      await ready;
      let changed = false;
      const mutation = machines.locked(id, async () => {
        changed = true;
      });
      await new Promise<void>((done) => setImmediate(done));
      assert.equal(changed, false, 'The measured source must stay locked while admission waits');
      gate.release();
      await backups.jobs.wait(id);
      await mutation;
      assert.equal(job.status, 'done', job.error);
      const item = (await backups.view(id)).items[0];
      assert.ok(item.bytes < 16 * 1024 ** 2);
      assert.ok((await stat(disk)).size < 16 * 1024 ** 2);
      assert.equal(host.snapshot().resources.length, 0);
      assert.deepEqual(await readdir(join(root, 'transfers')), []);
    } finally {
      gate.release();
      await backups.close();
      host.close();
    }
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: real sparse LUKS QCOW2 measurement uses the encrypted output format before backup admission
 * 状态影响 / State effects: `machines.get(id).diskEncryption`, `machines.withDiskSecret`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `mkdir`, `vmDir`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done', job.error)`; `assert.ok((await backups.view(id)).items[0].bytes < 32 * 1024 ** 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test(
  'real sparse LUKS QCOW2 measurement uses the encrypted output format before backup admission',
  { skip: !existsSync(binary) },
  async () => {
    const { id, machines, backups, host } = fixture();
    await mkdir(vmDir(id), { recursive: true });
    const secret = join(vmDir(id), 'test-key'),
      disk = join(vmDir(id), 'disk.qcow2');
    await writeFile(secret, 'test-disk-password-not-a-real-secret', { mode: 0o600 });
    machines.get(id).diskEncryption = { format: 'luks', secretName: 'disk-password' };
    machines.withDiskSecret = /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _vm; work。
     * 结果：返回分支计算值（`work(secret)`），以 Promise 交付。
     * Result: Return the branch-computed value (`work(secret)`) through a Promise.
     * 验证场景 / Scenario: real sparse LUKS QCOW2 measurement uses the encrypted output format before backup admission
     * 协作入口 / Collaborators: `work`.
     */
    async (_vm, work) => work(secret);
    await execute(
      binary,
      [
        'create',
        '--object',
        qemuSecretObject(secret),
        '-f',
        'qcow2',
        '-o',
        'encrypt.format=luks,encrypt.key-secret=sakura-disk-key',
        disk,
        '128G',
      ],
      { windowsHide: true },
    );
    try {
      const job = await backups.run(id);
      await backups.jobs.wait(id);
      assert.equal(job.status, 'done', job.error);
      assert.ok((await backups.view(id)).items[0].bytes < 32 * 1024 ** 2);
      assert.equal(host.snapshot().resources.length, 0);
    } finally {
      await backups.close();
      host.close();
    }
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: backup verification failure releases I/O, but an actual materialized-file cleanup failure remains charged
 * 状态影响 / State effects: `bad[bad.length - 1]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `Buffer.from`, `JSON.stringify`, `digest`.
 * 检查边界 / Checked boundaries: `assert.rejects( backups.withVerifiedFile(id, badId, undefined, signal, async () => {}), /磁盘校验失败/, )`; `assert.equal(host.snapshot().resources.length, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('backup verification failure releases I/O, but an actual materialized-file cleanup failure remains charged', async () => {
  const { id, host, leases, backups } = fixture();
  const disk = Buffer.from('disk-content'),
    manifest = Buffer.from(JSON.stringify({ sha256: digest(disk) }));
  const prefix = Buffer.alloc(12);
  prefix.write('SAKURA01');
  prefix.writeUInt32BE(manifest.length, 8);
  const bundle = Buffer.concat([prefix, manifest, disk]),
    directory = join(root, 'backups', id);
  await mkdir(directory, { recursive: true });
  const index = metadataFile(join(directory, 'index.json'), () => ({
    policy: backupPolicySchema.parse({}),
    items: [] as any[],
  }));
  const bad = Buffer.from(bundle);
  bad[bad.length - 1] ^= 1;
  const badId = randomUUID(),
    badPath = join(directory, badId + '.sakura');
  await writeFile(badPath, bad);
  await index.replace({
    policy: backupPolicySchema.parse({}),
    items: [{ id: badId, bytes: bad.length, checksum: digest(bad) }],
  });
  try {
    await assert.rejects(
      backups.withVerifiedFile(id, badId, undefined, signal, async () => {}),
      /磁盘校验失败/,
    );
    assert.equal(host.snapshot().resources.length, 0);
    const goodId = randomUUID(),
      source = join(directory, 'source.sakura');
    await writeFile(source, bundle);
    await backupBlocks().pack(id, goodId, source, digest(bundle), signal);
    await index.replace({
      policy: backupPolicySchema.parse({}),
      items: [{ id: goodId, bytes: bundle.length, checksum: digest(bundle), storage: 'blocks' }],
    });
    let obstructed = '';
    await assert.rejects(
      backups.withVerifiedFile(id, goodId, undefined, signal, async (file) => {
        assert.deepEqual(await readFile(file), bundle);
        // Replace our own temporary file with a directory to force a real rm failure.
        await rm(file);
        await mkdir(file);
        await writeFile(join(file, 'held'), 'owned test fixture');
        obstructed = file;
      }),
      { code: 'STORAGE_CLEANUP_PENDING' },
    );
    assert.equal(host.snapshot().resources[0].state, 'cleanup-pending');
    assert.ok(host.snapshot().budgets.some((value) => value.key === 'io' && value.used === 1));
    assert.ok(resolve(obstructed).startsWith(resolve(root) + (process.platform === 'win32' ? '\\' : '/')));
    await rm(obstructed, { recursive: true, force: true });
    leases.at(-1)!.release();
    assert.equal(host.snapshot().resources.length, 0);
  } finally {
    for (const lease of leases) lease.release();
    await backups.close();
    host.close();
  }
});

/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: f: ReturnType<typeof fixture>; options: { indexed?: boolean; corrupt?: boolean; stagedOnly?: boolean } = {}。
 * 结果：返回受控对象，公开字段包括 `directory, file, record, journal`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `directory, file, record, journal`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `import`, `join`, `randomUUID`, `Buffer.from`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function interruptedPublication(
  f: ReturnType<typeof fixture>,
  options: { indexed?: boolean; corrupt?: boolean; stagedOnly?: boolean } = {},
) {
  const { backupPublication } = await import('../server/backup-journal.ts');
  const directory = join(root, 'backups', f.id),
    backupId = randomUUID(),
    bytes = Buffer.from('verified publication fixture');
  await mkdir(directory, { recursive: true });
  const record = {
    id: backupId,
    createdAt: new Date().toISOString(),
    bytes: bytes.length,
    checksum: digest(bytes),
  };
  const file = join(directory, backupId + '.sakura');
  if (!options.stagedOnly) await writeFile(file, options.corrupt ? Buffer.from('tampered') : bytes);
  await writeFile(file + '.part', 'interrupted owned staging');
  const journal = backupPublication(join(directory, 'publication.json'));
  await journal.replace({
    version: 1,
    id: backupId,
    encrypted: false,
    deduplicate: false,
    record,
    obsolete: [],
  });
  if (options.indexed)
    await metadataFile(join(directory, 'index.json'), () => ({})).replace({
      policy: backupPolicySchema.parse({}),
      items: [record],
    });
  return { directory, file, record, journal };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: restarted backup controller reconciles publish-before-index and index-before-cleanup without another export
 * 状态影响 / State effects: `f.bundles.withExportBudget`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `interruptedPublication`, `restarted.view`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual( view.items.map((value) => value.id), [item.record.id], )`; `assert.equal(view.items[0].checksum, item.record.checksum)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('restarted backup controller reconciles publish-before-index and index-before-cleanup without another export', async () => {
  for (const indexed of [false, true]) {
    const f = fixture(),
      item = await interruptedPublication(f, { indexed });
    f.bundles.withExportBudget = /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: restarted backup controller reconciles publish-before-index and index-before-cleanup without another export
     * 失败 / Failure: `new Error('Recovery must never replay source export')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    async () => {
      throw new Error('Recovery must never replay source export');
    };
    try {
      const restarted = new Backups(f.machines, f.bundles, undefined, f.storage);
      const view = await restarted.view(f.id);
      assert.deepEqual(
        view.items.map((value) => value.id),
        [item.record.id],
      );
      assert.equal(view.items[0].checksum, item.record.checksum);
      assert.deepEqual(await readFile(item.file), Buffer.from('verified publication fixture'));
      await assert.rejects(stat(item.file + '.part'), { code: 'ENOENT' });
      assert.equal((await item.journal.read()).value, null);
      assert.equal((await restarted.view(f.id)).items.length, 1, 'Reconciliation is idempotent');
      assert.equal(f.host.snapshot().resources.length, 0);
      await restarted.close();
    } finally {
      await f.backups.close();
      f.host.close();
    }
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: interrupted staging is discarded, while a changed published backup remains available for inspection
 * 协作入口 / Collaborators: `fixture`, `interruptedPublication`, `assert.equal`, `staged.backups.view`.
 * 检查边界 / Checked boundaries: `assert.equal((await staged.backups.view(staged.id)).items.length, 0)`; `assert.rejects(stat(draft.file + '.part'), { code: 'ENOENT' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('interrupted staging is discarded, while a changed published backup remains available for inspection', async () => {
  const staged = fixture(),
    draft = await interruptedPublication(staged, { stagedOnly: true });
  try {
    assert.equal((await staged.backups.view(staged.id)).items.length, 0);
    await assert.rejects(stat(draft.file + '.part'), { code: 'ENOENT' });
    assert.equal((await draft.journal.read()).value, null);
  } finally {
    await staged.backups.close();
    staged.host.close();
  }
  const corrupt = fixture(),
    damaged = await interruptedPublication(corrupt, { corrupt: true });
  try {
    await assert.rejects(corrupt.backups.view(corrupt.id), { code: 'BACKUP_RECOVERY_REQUIRED' });
    assert.equal((await readFile(damaged.file)).toString(), 'tampered');
    assert.ok((await damaged.journal.read()).value, 'Failed verification preserves the recovery record');
    assert.equal(
      corrupt.host.snapshot().resources.length,
      0,
      'Verification failure alone does not retain I/O',
    );
  } finally {
    await corrupt.backups.close();
    corrupt.host.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: reconciliation completes a journaled obsolete-file cleanup and preserves newly protected backups
 * 协作入口 / Collaborators: `fixture`, `interruptedPublication`, `randomUUID`, `new Date(Date.now() + 60_000).toISOString`.
 * 检查边界 / Checked boundaries: `assert.deepEqual( view.items.map((value) => value.id), [item.record.id, protectedItem.id], )`; `assert.rejects(stat(join(item.directory, obsolete.id + '.sakura')), { code: 'ENOENT' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('reconciliation completes a journaled obsolete-file cleanup and preserves newly protected backups', async () => {
  const f = fixture(),
    item = await interruptedPublication(f, { indexed: true });
  const obsolete = { ...item.record, id: randomUUID() },
    protectedItem = {
      ...item.record,
      id: randomUUID(),
      retainUntil: new Date(Date.now() + 60_000).toISOString(),
    };
  const index = metadataFile<any>(join(item.directory, 'index.json'), () => ({}));
  await index.update((value) => {
    value.items.push(obsolete, protectedItem);
  });
  await writeFile(join(item.directory, obsolete.id + '.sakura'), 'old');
  await writeFile(join(item.directory, protectedItem.id + '.sakura'), 'protected');
  await item.journal.update((value) => {
    value!.obsolete = [obsolete, protectedItem];
  });
  try {
    const view = await f.backups.view(f.id);
    assert.deepEqual(
      view.items.map((value) => value.id),
      [item.record.id, protectedItem.id],
    );
    await assert.rejects(stat(join(item.directory, obsolete.id + '.sakura')), { code: 'ENOENT' });
    assert.equal(
      (await readFile(join(item.directory, protectedItem.id + '.sakura'))).toString(),
      'protected',
    );
  } finally {
    await f.backups.close();
    f.host.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an obstructed recovery temporary file retains I/O and repeat reads report the same failure without queueing again
 * 协作入口 / Collaborators: `fixture`, `interruptedPublication`, `rm`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.backups.view(f.id), { code: 'STORAGE_CLEANUP_PENDING' })`; `assert.equal(held.state, 'cleanup-pending')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('an obstructed recovery temporary file retains I/O and repeat reads report the same failure without queueing again', async () => {
  const f = fixture(),
    item = await interruptedPublication(f);
  const temporary = item.file + '.part';
  await rm(temporary);
  await mkdir(temporary);
  await writeFile(join(temporary, 'held'), 'fixture');
  try {
    await assert.rejects(f.backups.view(f.id), { code: 'STORAGE_CLEANUP_PENDING' });
    const held = f.host.snapshot().resources[0];
    assert.equal(held.state, 'cleanup-pending');
    await assert.rejects(f.backups.view(f.id), { code: 'STORAGE_CLEANUP_PENDING' });
    assert.equal(f.host.snapshot().queued, 0);
    assert.ok((await item.journal.read()).value);
    assert.equal(f.host.snapshot().resources[0].id, held.id);
    await rm(temporary, { recursive: true, force: true });
    f.leases.at(-1)!.release();
  } finally {
    for (const lease of f.leases) lease.release();
    await f.backups.close();
    f.host.close();
  }
});
