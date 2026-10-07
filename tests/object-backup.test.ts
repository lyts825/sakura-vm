/**
 * 模块职责：回归验证模块，围绕 `object-backup` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `object-backup`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: S3 target checks, multipart upload, integrity, restore and deletion.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile, mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mockS3 } from '../scripts/support/mock-s3.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: S3 target checks, multipart upload, integrity, restore and deletion
 * 状态影响 / State effects: `process.env.SAKURA_DATA_DIR`, `corrupted[corrupted.length - 1]`, `metadata.retainUntil`, `brokenLocal[brokenLocal.length - 1]`, `credentialsAvailable`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `import`.
 * 检查边界 / Checked boundaries: `assert.equal((await object.action(id, { mode: 'status' }, 'run', signal)).ready, false)`; `assert.equal(checked.ready, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('S3 target checks, multipart upload, integrity, restore and deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-object-test-'));
  process.env.SAKURA_DATA_DIR = join(root, 'data');
  const { ObjectBackup } = await import('../server/object-backup.ts');
  const { verifyBackup } = await import('../server/backups.ts');
  const { storageRuntime } = await import('../server/storage-runtime.ts');
  const { vmDir } = await import('../server/model.ts');
  const id = randomUUID(), backupId = randomUUID(), restoredId = randomUUID();
  const payload = Buffer.alloc(9 * 1024 * 1024, 0x61);
  const manifest = Buffer.from(JSON.stringify({ sha256: createHash('sha256').update(payload).digest('hex') }));
  const prefix = Buffer.alloc(12);
  prefix.write('SAKURA01'); prefix.writeUInt32BE(manifest.length, 8);
  const file = join(root, 'backup.sakura');
  const content = Buffer.concat([prefix, manifest, payload]);
  await writeFile(file, content);
  const item = { id: backupId, bytes: content.length,
    checksum: createHash('sha256').update(content).digest('hex'),
    createdAt: new Date().toISOString(), encrypted: false,
    retainUntil: new Date(Date.now() + 3600_000).toISOString() };
  await mkdir(vmDir(id), { recursive: true });
  const s3 = await mockS3();
  const machines = { records: new Map([[id, { id }]]), /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id })`）。
   * Result: Return the branch-computed value (`({ id })`).
   * 验证场景 / Scenario: S3 target checks, multipart upload, integrity, restore and deletion
   */
  get: () => ({ id }), /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: S3 target checks, multipart upload, integrity, restore and deletion
   */
  requireUnlocked: () => {},
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _key: string; work: () => Promise<unknown>。
     * 结果：返回分支计算值（`work()`），以 Promise 交付。
     * Result: Return the branch-computed value (`work()`) through a Promise.
     * 验证场景 / Scenario: S3 target checks, multipart upload, integrity, restore and deletion
     * 协作入口 / Collaborators: `work`.
     */
    locked: async (_key: string, work: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => work() };
  const backups = {
    jobs: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`null`）。
     * Result: Return the branch-computed value (`null`).
     * 验证场景 / Scenario: S3 target checks, multipart upload, integrity, restore and deletion
     */
    view: () => null },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ items: [item] })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ items: [item] })`) through a Promise.
     * 验证场景 / Scenario: S3 target checks, multipart upload, integrity, restore and deletion
     */
    view: async () => ({ items: [item] }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; _backupId: string; _password: string | undefined; signal: AbortSignal; work: (...args: any[]) => Promise<unknown>。
     * 结果：返回分支计算值（`storageRuntime.run({ owner: 'test:object-backup', taskId: 'object-fixture', labe…`），以 Promise 交付。
     * Result: Return the branch-computed value (`storageRuntime.run({ owner: 'test:object-backup', taskId: 'object-fixture', labe…`) through a Promise.
     * 验证场景 / Scenario: S3 target checks, multipart upload, integrity, restore and deletion
     * 协作入口 / Collaborators: `storageRuntime.run`.
     */
    withVerifiedFile: async (_id: string, _backupId: string, _password: string | undefined,
      signal: AbortSignal, work: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: args: any[]。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      (...args: any[]) => Promise<unknown>) => storageRuntime.run({
      owner: 'test:object-backup', taskId: 'object-fixture', label: 'Verify and upload fixture', mode: 'read',
      paths: [file], buffers: 40 * 1024 ** 2, files: 8, signal }, async (lease) => {
      await verifyBackup(file, signal, lease); return work(file, lease, file);
    }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ type: 'file' as const, path: file })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ type: 'file' as const, path: file })`) through a Promise.
     * 验证场景 / Scenario: S3 target checks, multipart upload, integrity, restore and deletion
     */
    downloadable: async () => ({ type: 'file' as const, path: file }),
  };
  const restored: string[] = [];
  const bundles = { /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: name: string; stream: NodeJS.ReadableStream。
   * 结果：返回受控对象，公开字段包括 `id, name`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `id, name`; the actual branch determines its shape.
   * 验证场景 / Scenario: S3 target checks, multipart upload, integrity, restore and deletion
   * 协作入口 / Collaborators: `restored.push`.
   */
  importExternal: async (name: string, stream: NodeJS.ReadableStream) => {
    restored.push(name);
    for await (const _chunk of stream) { /* consume verified bundle */ }
    return { id: restoredId, name };
  } };
  let credentialsAvailable = true;
  const secrets = { /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: _id: string; name: string。
   * 结果：返回分支计算值（`JSON.stringify({ accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret…`），以 Promise 交付。
   * Result: Return the branch-computed value (`JSON.stringify({ accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret…`) through a Promise.
   * 验证场景 / Scenario: S3 target checks, multipart upload, integrity, restore and deletion
   * 失败 / Failure: `new Error('Credentials unavailable')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `assert.equal`, `JSON.stringify`.
   * 检查边界 / Checked boundaries: `assert.equal(name, 'S3Credentials')`.
   */
  value: async (_id: string, name: string) => {
    assert.equal(name, 'S3Credentials');
    if (!credentialsAvailable) throw new Error('Credentials unavailable');
    return JSON.stringify({ accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' });
  } };
  const object = new ObjectBackup(machines as never, () =>
    ({ backups: backups as never, bundles: bundles as never, secrets: secrets as never }));
  const signal = new AbortController().signal;
  const target = { endpoint: s3.endpoint, bucket: 'sakura-test', prefix: 'checks',
    credentialSecret: 'S3Credentials' };
  const remoteId = `${id}/${backupId}`;
  try {
    assert.equal((await object.action(id, { mode: 'status' }, 'run', signal)).ready, false);
    const checked = await object.action(id, { mode: 'save', target }, 'check', signal);
    assert.equal(checked.ready, true);
    assert.equal(checked.executed, false);
    assert.equal((await object.action(id, { mode: 'status' }, 'run', signal)).ready, false);
    await object.action(id, { mode: 'save', target }, 'run', signal);
    const saved = await readFile(join(vmDir(id), 'object-backup.json'), 'utf8');
    assert.ok(!saved.includes('fixture-secret'));
    const first = await object.action(id, { mode: 'upload', backupId }, 'run', signal);
    assert.equal(first.executed, true);
    assert.ok(s3.partCount >= 2, '9 MiB backup must use multipart upload');
    const second = await object.action(id, { mode: 'upload', backupId }, 'run', signal);
    assert.equal(second.executed, false, 'same remote bytes are reused');
    const listed = await object.action(id, { mode: 'list' }, 'run', signal);
    assert.ok('entries' in listed && listed.entries?.some((entry) => entry.remoteId === remoteId));
    const dataKey = `checks/sakura-backups/${id}/${backupId}.sakura`;
    const original = s3.objects.get(dataKey)!;
    assert.ok(original);
    const corrupted = Buffer.from(original);
    corrupted[corrupted.length - 1] ^= 0xff;
    s3.objects.set(dataKey, corrupted);
    await assert.rejects(() => object.action(id, { mode: 'verify', remoteId }, 'run', signal),
      /SHA-256/);
    await assert.rejects(() => object.action(id, { mode: 'restore', remoteId,
      restoreName: 'should-not-exist' }, 'run', signal), /SHA-256/);
    assert.deepEqual(restored, []);
    s3.objects.set(dataKey, original);
    const verified = await object.action(id, { mode: 'verify', remoteId }, 'run', signal);
    assert.ok('verified' in verified && verified.verified);
    const result = await object.action(id, { mode: 'restore', remoteId,
      restoreName: 'object-restored' }, 'run', signal);
    assert.ok('restoredVmId' in result && result.restoredVmId === restoredId);
    assert.deepEqual(restored, ['object-restored']);
    await assert.rejects(() => object.action(id, { mode: 'delete', remoteId }, 'run', signal),
      /保留锁定期/);
    const metadataKey = `checks/sakura-backups/${id}/${backupId}.json`;
    const metadata = JSON.parse(s3.objects.get(metadataKey)!.toString());
    metadata.retainUntil = new Date(Date.now() - 1000).toISOString();
    s3.objects.set(metadataKey, Buffer.from(JSON.stringify(metadata)));
    await object.action(id, { mode: 'delete', remoteId }, 'run', signal);
    const empty = await object.action(id, { mode: 'list' }, 'run', signal);
    assert.ok('entries' in empty && empty.entries?.length === 0);
    await object.action(id, { mode: 'save', target: { ...target, autoUpload: true } }, 'run', signal);
    const brokenLocal = Buffer.from(content);
    brokenLocal[brokenLocal.length - 1] ^= 0xff;
    await writeFile(file, brokenLocal);
    await object.tick();
    const failed = await object.action(id, { mode: 'status' }, 'run', signal);
    assert.ok('sync' in failed && failed.sync?.lastError?.includes('备份磁盘校验失败'));
    assert.ok(!s3.objects.has(dataKey));
    await writeFile(file, content);
    await object.tick();
    assert.ok(!s3.objects.has(dataKey), 'failed automatic sync waits before retry');
    await object.tick(Date.now() + 300_001);
    const automatic = await object.action(id, { mode: 'status' }, 'run', signal);
    assert.ok('sync' in automatic && automatic.sync?.mirrored[backupId] === item.checksum);
    assert.ok(s3.objects.has(dataKey), 'automatic sync must republish a local backup');
    credentialsAvailable = false;
    const unavailable = await object.action(id, { mode: 'status' }, 'run', signal);
    assert.equal(unavailable.ready, false);
    assert.ok('sync' in unavailable && unavailable.sync?.mirrored[backupId] === item.checksum);
  } finally {
    await object.close();
    await s3.close();
    await rm(root, { recursive: true, force: true });
  }
});
