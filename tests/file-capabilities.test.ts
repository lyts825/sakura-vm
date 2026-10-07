/**
 * 模块职责：回归验证模块，围绕 `file-capabilities` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `file-capabilities`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: resumable uploads survive restart, verify chunks and commit idempotently; persisted chunk tampering is detected before writing the guest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ResumableUploads, UPLOAD_CHUNK_BYTES } from '../server/resumable-uploads.ts';
import { previewFile, csvRows } from '../server/file-preview.ts';

const id = '11111111-1111-4111-8111-111111111111';
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: data: Buffer。
 * 结果：返回分支计算值（`createHash('sha256').update(data).digest('hex')`）。
 * Result: Return the branch-computed value (`createHash('sha256').update(data).digest('hex')`).
 * 协作入口 / Collaborators: `createHash('sha256').update(data).digest`, `createHash('sha256').update`, `createHash`.
 */
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: resumable uploads survive restart, verify chunks and commit idempotently
 * 状态影响 / State effects: `failAfterWrite`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Buffer.alloc`.
 * 检查边界 / Checked boundaries: `assert.rejects(service.chunk(id, session.id, 0, Readable.from(Buffer.from('bad')), signal), /校验/)`; `assert.equal(resumed.id, session.id)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('resumable uploads survive restart, verify chunks and commit idempotently', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-upload-test-'));
  const saved = new Map<string, Buffer>();
  let uploadCount = 0,
    failAfterWrite = false;
  const files: any = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; path: string; source: Readable。
     * 结果：返回受控对象，公开字段包括 `bytes`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `bytes`; the actual branch determines its shape.
     * 验证场景 / Scenario: resumable uploads survive restart, verify chunks and commit idempotently
     * 状态影响 / State effects: `failAfterWrite`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('lost response')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `chunks.push`, `Buffer.from`, `Buffer.concat`, `saved.set`.
     */
    upload: async (_id: string, path: string, source: Readable) => {
      const chunks = [];
      for await (const chunk of source) chunks.push(Buffer.from(chunk));
      const data = Buffer.concat(chunks);
      saved.set(path, data);
      uploadCount++;
      if (failAfterWrite) {
        failAfterWrite = false;
        throw new Error('lost response');
      }
      return { bytes: data.length };
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; path: string。
     * 结果：返回分支计算值（`({ size: saved.get(path)?.length })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ size: saved.get(path)?.length })`) through a Promise.
     * 验证场景 / Scenario: resumable uploads survive restart, verify chunks and commit idempotently
     * 协作入口 / Collaborators: `saved.get`.
     */
    info: async (_id: string, path: string) => ({ size: saved.get(path)?.length }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; path: string; target: any。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: resumable uploads survive restart, verify chunks and commit idempotently
     * 失败 / Failure: `new Error('missing')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `saved.has`, `pipeline`, `Readable.from`, `saved.get`.
     */
    download: async (_id: string, path: string, target: any) => {
      if (!saved.has(path)) throw new Error('missing');
      await pipeline(Readable.from(saved.get(path)!), target);
    },
  };
  const signal = new AbortController().signal;
  try {
    const parts = [Buffer.alloc(UPLOAD_CHUNK_BYTES, 7), Buffer.from('last chunk')];
    const request = {
      path: '/workspace/file.bin',
      size: parts.reduce((sum, part) => sum + part.length, 0),
      chunks: parts.map(sha),
    };
    const service = new ResumableUploads(files, directory);
    const session = await service.create(id, request);
    await assert.rejects(service.chunk(id, session.id, 0, Readable.from(Buffer.from('bad')), signal), /校验/);
    await service.chunk(id, session.id, 0, Readable.from(parts[0]), signal);
    const restarted = new ResumableUploads(files, directory);
    const resumed = await restarted.create(id, request);
    assert.equal(resumed.id, session.id);
    assert.deepEqual(resumed.received, [0]);
    await assert.rejects(restarted.commit(id, session.id, signal), /不完整/);
    await restarted.chunk(id, session.id, 1, Readable.from(parts[1]), signal);
    failAfterWrite = true;
    await assert.rejects(restarted.commit(id, session.id, signal), /lost response/);
    const done = await new ResumableUploads(files, directory).commit(id, session.id, signal);
    assert.equal(done.sha256, sha(Buffer.concat(parts)));
    assert.equal(uploadCount, 1);
    assert.deepEqual(saved.get(request.path), Buffer.concat(parts));
    await restarted.commit(id, session.id, signal);
    assert.equal(uploadCount, 1);
    saved.set(request.path, Buffer.from('external edit'));
    assert.notEqual((await restarted.create(id, request)).id, session.id);
    await assert.rejects(restarted.commit(id, session.id, signal), /发生变化/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: persisted chunk tampering is detected before writing the guest
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Buffer.from`.
 * 检查边界 / Checked boundaries: `assert.rejects(service.commit(id, session.id, new AbortController().signal), /校验失败/)`; `assert.equal(writes, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('persisted chunk tampering is detected before writing the guest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-upload-tamper-'));
  let writes = 0;
  try {
    const service = new ResumableUploads(
      {
        /**
         * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
         * English: Read or resolve observable fixture state for business calls or subsequent assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回受控对象，公开字段包括 `bytes`；各分支以实际返回对象为准。
         * Result: Return a controlled object exposing fields such as `bytes`; the actual branch determines its shape.
         * 验证场景 / Scenario: persisted chunk tampering is detected before writing the guest
         */
        upload: async () => {
          writes++;
          return { bytes: 4 };
        },
      } as any,
      directory,
    );
    const payload = Buffer.from('good');
    const session = await service.create(id, {
      path: '/workspace/file',
      size: payload.length,
      chunks: [sha(payload)],
    });
    await service.chunk(id, session.id, 0, Readable.from(payload), new AbortController().signal);
    await writeFile(join(directory, id, session.id, '0.chunk'), 'evil');
    await assert.rejects(service.commit(id, session.id, new AbortController().signal), /校验失败/);
    assert.equal(writes, 0);
    await assert.rejects(service.remove(id, '../outside'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: binary preview identifies content and parses quoted CSV without evaluating cells
 * 协作入口 / Collaborators: `assert.equal`, `previewFile`, `Buffer.from`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(previewFile('not-an-image.txt', Buffer.from('89504e470d0a1a0a', 'hex')).kind, 'image')`; `assert.equal(previewFile('document.pdf', Buffer.from('%PDF-1.7\n')).kind, 'pdf')`.
 */
test('binary preview identifies content and parses quoted CSV without evaluating cells', () => {
  assert.equal(previewFile('not-an-image.txt', Buffer.from('89504e470d0a1a0a', 'hex')).kind, 'image');
  assert.equal(previewFile('document.pdf', Buffer.from('%PDF-1.7\n')).kind, 'pdf');
  assert.deepEqual(csvRows('a,"b,c","line\nnext"\r\n1,"quoted ""value""",=CMD()').rows, [
    ['a', 'b,c', 'line\nnext'],
    ['1', 'quoted "value"', '=CMD()'],
  ]);
  assert.equal(previewFile('large.bin', Buffer.from('head'), 20 * 1024 ** 2).kind, 'hex');
  assert.throws(() => previewFile('bad.zip', Buffer.alloc(30)), /ZIP/);
  assert.throws(() => previewFile('bad.tar', Buffer.alloc(1024, 1)), /TAR/);
});
