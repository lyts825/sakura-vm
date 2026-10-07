/**
 * 模块职责：回归验证模块，围绕 `backup-recovery` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `backup-recovery`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: file recovery requires explicit valid backup, partition and bounded file selection; plain, encrypted and deduplicated backups yield verified disks, files and durable reports without registering an instance.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import assert from 'node:assert/strict';
import test, { after, type TestContext } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { Engine } from '../server/runtime.ts';
import type { BackupRecord } from '../server/backups.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-recovery-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Bundles } = await import('../server/bundles.ts');
const { Backups, backupPolicySchema } = await import('../server/backups.ts');
const { BackupRecovery } = await import('../server/backup-recovery.ts');
const { Jobs } = await import('../server/jobs.ts');
const { SandboxArtifacts } = await import('../server/sandbox-artifacts.ts');
const { backupBlocks } = await import('../server/backup-blocks.ts');
const { storageRuntime } = await import('../server/storage-runtime.ts');
const { createSchema } = await import('../server/model.ts');
const { createSshKey, seedIso } = await import('../server/seed.ts');
const { encryptFile } = await import('../server/encrypted-backups.ts');
const { backupRecoverySchema } = await import('../shared/backup-recovery.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-recovery-test-'));
  await rm(root, { recursive: true, force: true });
});
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: value: Buffer。
 * 结果：返回分支计算值（`createHash('sha256').update(value).digest('hex')`）。
 * Result: Return the branch-computed value (`createHash('sha256').update(value).digest('hex')`).
 * 协作入口 / Collaborators: `createHash('sha256').update(value).digest`, `createHash('sha256').update`, `createHash`.
 */
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const signal = new AbortController().signal;
const privateKey = createSshKey().privateText;
const disk = Buffer.alloc(4096);
disk.writeUInt32BE(0x514649fb);
disk.writeUInt32BE(3, 4);
disk.writeBigUInt64BE(4n * 1024n ** 3n, 24);
disk.write('backup disk', 256);
const manifest = Buffer.from(
  JSON.stringify({
    version: 1,
    config: createSchema.parse({ name: 'from-backup' }),
    key: privateKey,
    seed: seedIso({ 'user-data': 'fixture' }).toString('base64'),
    sha256: hash(disk),
  }),
);
const length = Buffer.alloc(4);
length.writeUInt32BE(manifest.length);
const bundle = Buffer.concat([Buffer.from('SAKURA01'), length, manifest, disk]);

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext。
 * 结果：返回受控对象，公开字段包括 `id, directory, machines, bundles, backups, service, jobs, add, items`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, directory, machines, bundles, backups, service, jobs, add, items`; the actual branch determines its shape.
 * 状态影响 / State effects: `machines.withRescue`, `machines.exec`, `machines.sftp`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `join`, `mkdir`, `machines.records.set`.
 */
async function fixture(t: TestContext) {
  const id = randomUUID(),
    directory = join(root, 'backups', id),
    artifactsDirectory = join(root, 'artifacts', id);
  await mkdir(directory, { recursive: true });
  const machines = new Machines(
    { /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'{}'`），以 Promise 交付。
     * Result: Return the branch-computed value (`'{}'`) through a Promise.
     */
    run: async () => '{}', runtime: { /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    close: async () => {} } } as unknown as Engine,
    fakeVmNetwork,
  );
  machines.records.set(id, {
    ...createSchema.parse({ name: 'source' }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  const bundles = new Bundles(machines),
    backups = new Backups(machines, bundles),
    jobs = new Jobs('backup-recovery', join(root, 'jobs', id));
  const artifacts = new SandboxArtifacts(machines, artifactsDirectory);
  const service = new BackupRecovery(machines, backups, bundles, jobs, artifacts);
  const items: BackupRecord[] = [];
  let boots = 0,
    cleaned = 0,
    ready: (/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void) | undefined,
    hold = false;
  machines.withRescue = (/**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: _id; abort; _phase; work; _log; file。
   * 结果：返回分支计算值（`machines.locked(id, async () => { assert.deepEqual(await readFile(file!), disk);…`），以 Promise 交付。
   * Result: Return the branch-computed value (`machines.locked(id, async () => { assert.deepEqual(await readFile(file!), disk);…`) through a Promise.
   * 协作入口 / Collaborators: `machines.locked`.
   */
  async (_id, abort, _phase, work, _log, file) =>
    machines.locked(id, async () => {
      assert.deepEqual(await readFile(file!), disk);
      boots++;
      try {
        ready?.();
        if (hold) await delay(60000, undefined, { signal: abort });
        return await work('temporary-rescue', abort);
      } finally {
        cleaned++;
      }
    })) as typeof machines.withRescue;
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ code: 0, stdout: '', stderr: '' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 0, stdout: '', stderr: '' })`) through a Promise.
   */
  async () => ({ code: 0, stdout: '', stderr: '' });
  machines.sftp = (/**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: _id; work。
   * 结果：返回分支计算值（`work( { realpath: (path: string, callback: (error: null, value: string) => void)…`），以 Promise 交付。
   * Result: Return the branch-computed value (`work( { realpath: (path: string, callback: (error: null, value: string) => void)…`) through a Promise.
   * 协作入口 / Collaborators: `work`.
   */
  async (_id, work) =>
    work(
      {
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: path: string; callback: (error: null, value: string) => void。
         * 结果：返回分支计算值（`callback(null, path.endsWith('/escape') ? '/etc/shadow' : path)`）。
         * Result: Return the branch-computed value (`callback(null, path.endsWith('/escape') ? '/etc/shadow' : path)`).
         * 协作入口 / Collaborators: `callback`, `path.endsWith`.
         */
        realpath: (path: string, callback: /**
         * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
         * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
         * 输入 / Inputs: error: null; value: string。
         * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
         * Result: The declared return type defines the result; its test provider supplies the implementation.
         */
        (error: null, value: string) => void) =>
          callback(null, path.endsWith('/escape') ? '/etc/shadow' : path),
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: path: string; callback: (error: null, value: unknown) => void。
         * 结果：返回分支计算值（`callback(null, { size: path.endsWith('/huge') ? 9 * 1024 ** 2 : 8, isFile: () =>…`）。
         * Result: Return the branch-computed value (`callback(null, { size: path.endsWith('/huge') ? 9 * 1024 ** 2 : 8, isFile: () =>…`).
         * 协作入口 / Collaborators: `callback`, `path.endsWith`.
         */
        lstat: (path: string, callback: /**
         * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
         * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
         * 输入 / Inputs: error: null; value: unknown。
         * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
         * Result: The declared return type defines the result; its test provider supplies the implementation.
         */
        (error: null, value: unknown) => void) =>
          callback(null, { size: path.endsWith('/huge') ? 9 * 1024 ** 2 : 8, /**
           * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
           * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
           * 输入 / Inputs: 无 / none。
           * 结果：返回布尔判定，供用例选择路径或核对受控条件。
           * Result: Return a boolean decision for path selection or controlled-condition assertions.
           */
          isFile: () => true }),
        /**
         * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
         * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`Readable.from([Buffer.from('restored')])`）。
         * Result: Return the branch-computed value (`Readable.from([Buffer.from('restored')])`).
         * 协作入口 / Collaborators: `Readable.from`, `Buffer.from`.
         */
        createReadStream: () => Readable.from([Buffer.from('restored')]),
      } as any,
      signal,
    )) as typeof machines.sftp;
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`writeFile(join(directory, 'index.json'), JSON.stringify({ policy: backupPolicySc…`）。
   * Result: Return the branch-computed value (`writeFile(join(directory, 'index.json'), JSON.stringify({ policy: backupPolicySc…`).
   * 协作入口 / Collaborators: `writeFile`, `join`, `JSON.stringify`, `backupPolicySchema.parse`.
   */
  const saveIndex = () =>
    writeFile(join(directory, 'index.json'), JSON.stringify({ policy: backupPolicySchema.parse({}), items }));
  /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: kind: 'plain' | 'blocks' | 'encrypted' = 'plain'。
   * 结果：返回分支计算值（`item`），以 Promise 交付。
   * Result: Return the branch-computed value (`item`) through a Promise.
   * 状态影响 / State effects: `item.encrypted`, `item.checksum`, `item.bytes`, `item.storage`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `randomUUID`, `join`, `writeFile`, `new Date().toISOString`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  const add = async (kind: 'plain' | 'blocks' | 'encrypted' = 'plain') => {
    const backupId = randomUUID(),
      source = join(directory, backupId + '.sakura');
    await writeFile(source, bundle);
    const item: BackupRecord = {
      id: backupId,
      createdAt: new Date().toISOString(),
      bytes: bundle.length,
      checksum: hash(bundle),
    };
    if (kind === 'encrypted') {
      const encrypted = source + '.enc';
      await encryptFile(source, encrypted, 'fixture-password-2026', signal);
      const bytes = await readFile(encrypted);
      item.encrypted = true;
      item.checksum = hash(bytes);
      item.bytes = bytes.length;
      await rm(source);
    } else if (kind === 'blocks') {
      await backupBlocks().pack(id, backupId, source, item.checksum, signal);
      item.storage = 'blocks';
      await rm(source);
    }
    items.push(item);
    await saveIndex();
    return item;
  };
  t.after(async () => {
    await service.close();
    await backups.close();
    await machines.close();
  });
  return {
    id,
    directory,
    machines,
    bundles,
    backups,
    service,
    jobs,
    add,
    items,
    saveIndex,
    artifactsDirectory,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ boots, cleaned })`）。
     * Result: Return the branch-computed value (`({ boots, cleaned })`).
     */
    counts: () => ({ boots, cleaned }),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: callback: () => void。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `hold`, `ready`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    hold: (callback: /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void) => {
      hold = true;
      ready = callback;
    },
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: file recovery requires explicit valid backup, partition and bounded file selection
 * 协作入口 / Collaborators: `randomUUID`, `assert.equal`, `backupRecoverySchema.parse`, `Array.from`.
 * 检查边界 / Checked boundaries: `assert.equal(backupRecoverySchema.parse(good).partition, 0)`; `assert.equal(backupRecoverySchema.safeParse({ ...good, ...change }).success, false)`.
 */
test('file recovery requires explicit valid backup, partition and bounded file selection', () => {
  const good = { backupId: randomUUID(), paths: ['workspace/readme.txt'] };
  assert.equal(backupRecoverySchema.parse(good).partition, 0);
  for (const change of [
    { paths: [] },
    { paths: ['../outside'] },
    { paths: ['/absolute'] },
    { paths: ['a', 'a'] },
    { paths: Array.from({ length: 9 }, (_, i) => 'f' + i) },
    { partition: null },
    { partition: -1 },
    { command: 'arbitrary command' },
    { disk: 'C:\\host.qcow2' },
  ])
    assert.equal(backupRecoverySchema.safeParse({ ...good, ...change }).success, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plain, encrypted and deduplicated backups yield verified disks, files and durable reports without registering an instance
 * 协作入口 / Collaborators: `fixture`, `storageRuntime.acquire.bind`, `t.mock.method`, `f.add`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done', job.error)`; `assert.equal(Buffer.from(artifact.base64, 'base64').toString(), 'restored')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('plain, encrypted and deduplicated backups yield verified disks, files and durable reports without registering an instance', async (t) => {
  const f = await fixture(t);
  const acquire = storageRuntime.acquire.bind(storageRuntime);
  const requests: Parameters<typeof acquire>[0][] = [];
  t.mock.method(storageRuntime, 'acquire', (request: Parameters<typeof acquire>[0]) => {
    requests.push(request);
    assert.notEqual(
      request.owner,
      'core:sandbox-artifacts',
      'Recovery collection must borrow its enclosing writer',
    );
    return acquire(request);
  });
  for (const kind of ['plain', 'encrypted', 'blocks'] as const) {
    const item = await f.add(kind);
    const job = f.service.run(f.id, {
      backupId: item.id,
      paths: ['workspace/readme.txt'],
      password: kind === 'encrypted' ? 'fixture-password-2026' : undefined,
    });
    await f.jobs.wait(f.id);
    assert.equal(job.status, 'done', job.error);
    const artifact = await f.service.artifact(f.id, job.id!, job.execution!.artifacts[0].id);
    assert.equal(Buffer.from(artifact.base64, 'base64').toString(), 'restored');
    assert.equal(artifact.sha256, hash(Buffer.from('restored')));
    assert.equal((await f.jobs.result(job.id!)).backupId, item.id);
    assert.equal(f.machines.records.size, 1);
    assert.ok(!JSON.stringify(job).includes('fixture-password'));
    assert.ok(!JSON.stringify(job).includes(privateKey));
  }
  const recovery = requests.filter((request) => request.owner === 'core:backups');
  assert.equal(recovery.length, 3);
  assert.ok(recovery.every((request) => request.dynamicTemporary?.includes(f.artifactsDirectory)));
  await f.jobs.flush();
  const restored = new Jobs('backup-recovery', join(root, 'jobs', f.id));
  t.after(() => restored.close());
  assert.equal(restored.list().length, 3);
  assert.deepEqual(f.counts(), { boots: 3, cleaned: 3 });
  assert.deepEqual(await readdir(join(root, 'transfers')), []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: wrong passwords, broken bundle hashes and missing records fail before booting a rescue system
 * 状态影响 / State effects: `corrupted[corrupted.length - 1]`, `plain.checksum`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.add`, `f.service.run`, `f.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(invalid.status, 'error')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('wrong passwords, broken bundle hashes and missing records fail before booting a rescue system', async (t) => {
  const f = await fixture(t);
  const encrypted = await f.add('encrypted');
  const job = f.service.run(f.id, {
    backupId: encrypted.id,
    paths: ['workspace/readme.txt'],
    password: 'incorrect-password-2026',
  });
  await f.jobs.wait(f.id);
  assert.equal(job.status, 'error');
  const plain = await f.add();
  const corrupted = Buffer.from(bundle);
  corrupted[corrupted.length - 1] ^= 1;
  await writeFile(join(f.directory, plain.id + '.sakura'), corrupted);
  plain.checksum = hash(corrupted);
  await f.saveIndex();
  const invalid = f.service.run(f.id, { backupId: plain.id, paths: ['workspace/readme.txt'] });
  await f.jobs.wait(f.id);
  assert.equal(invalid.status, 'error');
  assert.match(invalid.error!, /磁盘校验失败/);
  const absent = f.service.run(f.id, { backupId: randomUUID(), paths: ['workspace/readme.txt'] });
  await f.jobs.wait(f.id);
  assert.match(absent.error!, /不存在/);
  assert.equal(f.counts().boots, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: file extraction rejects escaping links and oversized files and validates saved artifacts on download
 * 协作入口 / Collaborators: `fixture`, `f.add`, `f.service.run`, `f.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.execution!.artifacts.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('file extraction rejects escaping links and oversized files and validates saved artifacts on download', async (t) => {
  const f = await fixture(t),
    item = await f.add();
  for (const path of ['escape', 'huge']) {
    const job = f.service.run(f.id, { backupId: item.id, paths: [path] });
    await f.jobs.wait(f.id);
    assert.equal(job.status, 'error');
    assert.equal(job.execution!.artifacts.length, 0);
  }
  const job = f.service.run(f.id, { backupId: item.id, paths: ['workspace/readme.txt'] });
  await f.jobs.wait(f.id);
  const artifact = job.execution!.artifacts[0];
  await writeFile(join(f.artifactsDirectory, `${job.id}.${artifact.id}.bin`), 'tampered');
  await assert.rejects(f.service.artifact(f.id, job.id!, artifact.id), /校验失败/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: active recovery locks the backup against removal and cancels before temporary disk cleanup
 * 协作入口 / Collaborators: `fixture`, `f.add`, `f.service.run`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.backups.operate(f.id, item.id, 'delete'), /另一项/)`; `assert.rejects(f.machines.start(f.id), /另一项/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('active recovery locks the backup against removal and cancels before temporary disk cleanup', async (t) => {
  const f = await fixture(t),
    item = await f.add();
  const ready = new Promise<void>((done) => f.hold(done));
  const job = f.service.run(f.id, { backupId: item.id, paths: ['workspace/readme.txt'] });
  await ready;
  await assert.rejects(f.backups.operate(f.id, item.id, 'delete'), /另一项/);
  await assert.rejects(f.machines.start(f.id), /另一项/);
  f.jobs.cancel(f.id);
  await f.jobs.wait(f.id);
  assert.equal(job.status, 'cancelled');
  assert.deepEqual(f.counts(), { boots: 1, cleaned: 1 });
  assert.deepEqual(await readdir(join(root, 'transfers')), []);
  assert.equal(f.machines.isBusy(f.id), false);
  await f.backups.operate(f.id, item.id, 'delete');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: incident lockdown and service shutdown cancel admitted recovery and reject new requests
 * 状态影响 / State effects: `ready`, `job`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.add`, `f.service.run`, `f.machines.setIncidentLockdown`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'cancelled')`; `assert.equal(job.status, 'cancelled')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('incident lockdown and service shutdown cancel admitted recovery and reject new requests', async (t) => {
  const f = await fixture(t),
    item = await f.add();
  let ready = new Promise<void>((done) => f.hold(done));
  let job = f.service.run(f.id, { backupId: item.id, paths: ['workspace/readme.txt'] });
  await ready;
  await f.machines.setIncidentLockdown(f.id, true);
  await f.jobs.wait(f.id);
  assert.equal(job.status, 'cancelled');
  await f.machines.setIncidentLockdown(f.id, false);
  ready = new Promise<void>((done) => f.hold(done));
  job = f.service.run(f.id, { backupId: item.id, paths: ['workspace/readme.txt'] });
  await ready;
  await f.service.close();
  assert.equal(job.status, 'cancelled');
  assert.throws(() => f.service.run(f.id, { backupId: item.id, paths: ['workspace/readme.txt'] }), /关闭/);
  assert.deepEqual(await readdir(join(root, 'transfers')), []);
});
