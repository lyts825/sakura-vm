/**
 * 模块职责：回归验证模块，围绕 `object-upload` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `object-upload`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: revoked upload authority still permits exact multipart recovery while normal transfers retain checks; multipart cancellation waits for both part transports and the remote abort receipt before releasing buffers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { StorageRuntime, type StorageLease } from '../server/storage-runtime.ts';
import { OBJECT_PART_BYTES, OBJECT_UPLOAD_BUFFERS, uploadObjectFile } from '../server/object-upload.ts';
import { captureOperationCheck, withOperationCheck } from '../server/operation-context.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: revoked upload authority still permits exact multipart recovery while normal transfers retain checks
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `withOperationCheck`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.rejects( withOperationCheck( async () => { checks++; if (revoked) throw new Error('request authority revoked'); }, () => f.…`; `assert.ok(checks >= 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('revoked upload authority still permits exact multipart recovery while normal transfers retain checks', async () => {
  const f = await fixture(1);
  let revoked = false,
    aborted = false,
    checks = 0;
  const client = {
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: command: object。
     * 结果：返回受控对象，公开字段包括 `UploadId`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `UploadId`; the actual branch determines its shape.
     * 验证场景 / Scenario: revoked upload authority still permits exact multipart recovery while normal transfers retain checks
     * 状态影响 / State effects: `revoked`, `aborted`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('part failed')`; `new Error('unexpected upload command')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `captureOperationCheck()`, `captureOperationCheck`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    send: async (command: object) => {
      // A new managed network transport performs the same delayed admission check.
      await captureOperationCheck()();
      if (command.constructor.name === 'CreateMultipartUploadCommand') return { UploadId: 'owned' };
      if (command.constructor.name === 'UploadPartCommand') {
        revoked = true;
        throw new Error('part failed');
      }
      if (command.constructor.name === 'AbortMultipartUploadCommand') {
        aborted = true;
        return {};
      }
      throw new Error('unexpected upload command');
    },
  } as S3Client;
  try {
    await assert.rejects(
      withOperationCheck(
        async () => {
          checks++;
          if (revoked) throw new Error('request authority revoked');
        },
        () => f.upload(client),
      ),
      /part failed/,
    );
    assert.ok(checks >= 2);
    assert.equal(aborted, true);
    assert.equal(f.host.snapshot().resources.length, 0);
  } finally {
    await f.close();
  }
});

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, resolve`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, resolve`; the actual branch determines its shape.
 */
const deferred = () => {
  let resolve!: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: bytes = OBJECT_PART_BYTES + 1。
 * 结果：返回受控对象，公开字段包括 `root, file, host, abort, upload, close`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `root, file, host, abort, upload, close`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `writeFile`.
 */
async function fixture(bytes = OBJECT_PART_BYTES + 1) {
  const root = await mkdtemp(join(tmpdir(), 'sakura-multipart-budget-')),
    file = join(root, 'backup');
  await writeFile(file, Buffer.alloc(bytes));
  const host = new HostRuntime(),
    storage = new StorageRuntime(host),
    abort = new AbortController();
  let lease!: StorageLease;
  return {
    root,
    file,
    host,
    abort,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: client: S3Client。
     * 结果：返回分支计算值（`storage.run( { owner: 'test:multipart', taskId: 'upload', label: 'Upload', mode:…`）。
     * Result: Return the branch-computed value (`storage.run( { owner: 'test:multipart', taskId: 'upload', label: 'Upload', mode:…`).
     * 协作入口 / Collaborators: `storage.run`.
     */
    upload: (client: S3Client) =>
      storage.run(
        {
          owner: 'test:multipart',
          taskId: 'upload',
          label: 'Upload',
          mode: 'read',
          paths: [file],
          buffers: OBJECT_UPLOAD_BUFFERS,
          files: 1,
          signal: abort.signal,
        },
        (owned) => {
          lease = owned;
          return uploadObjectFile(client, 'bucket', 'backup/new/data', file, bytes, abort.signal, owned);
        },
      ),
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `lease?.release`, `host.close`, `assert.equal`, `dirname`.
     * 检查边界 / Checked boundaries: `assert.equal(dirname(root), resolve(tmpdir()))`.
     */
    async close() {
      lease?.release();
      host.close();
      assert.equal(dirname(root), resolve(tmpdir()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: multipart cancellation waits for both part transports and the remote abort receipt before releasing buffers
 * 协作入口 / Collaborators: `fixture`, `deferred`, `f.upload(client).finally`, `f.upload`.
 * 检查边界 / Checked boundaries: `assert.rejects(result, { name: 'AbortError' })`; `assert.equal(finished, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('multipart cancellation waits for both part transports and the remote abort receipt before releasing buffers', async () => {
  const f = await fixture(),
    entered = deferred(),
    settle = deferred(),
    abortEntered = deferred(),
    confirm = deferred();
  let workers = 0,
    remoteAborted = false,
    finished = false;
  const client = {
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: command: object; options: { abortSignal?: AbortSignal }。
     * 结果：返回受控对象，公开字段包括 `UploadId, ETag`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `UploadId, ETag`; the actual branch determines its shape.
     * 验证场景 / Scenario: multipart cancellation waits for both part transports and the remote abort receipt before releasing buffers
     * 状态影响 / State effects: `remoteAborted`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('Unexpected ' + command.constructor.name)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `entered.resolve`, `options!.abortSignal!.throwIfAborted`, `assert.equal`, `abortEntered.resolve`.
     * 检查边界 / Checked boundaries: `assert.equal(workers, 2)`.
     */
    send: async (command: object, options?: { abortSignal?: AbortSignal }) => {
      switch (command.constructor.name) {
        case 'CreateMultipartUploadCommand':
          return { UploadId: 'allocated' };
        case 'UploadPartCommand':
          if (++workers === 2) entered.resolve();
          await settle.promise;
          options!.abortSignal!.throwIfAborted();
          return { ETag: 'part' };
        case 'AbortMultipartUploadCommand':
          assert.equal(workers, 2);
          abortEntered.resolve();
          await confirm.promise;
          remoteAborted = true;
          return {};
        default:
          throw new Error('Unexpected ' + command.constructor.name);
      }
    },
  } as unknown as S3Client;
  const result = f.upload(client).finally(() => {
    finished = true;
  });
  const rejection = assert.rejects(result, { name: 'AbortError' });
  try {
    await entered.promise;
    f.abort.abort();
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(finished, false);
    assert.equal(f.host.snapshot().resources[0].cost['io.buffers'], OBJECT_UPLOAD_BUFFERS);
    settle.resolve();
    await abortEntered.promise;
    assert.equal(finished, false, 'An outstanding remote cleanup receipt still owns the file/buffer budget');
    confirm.resolve();
    await rejection;
    assert.equal(remoteAborted, true);
    assert.equal(f.host.snapshot().resources.length, 0);
  } finally {
    settle.resolve();
    confirm.resolve();
    await f.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a missing remote multipart cleanup receipt remains charged after cancellation
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.upload`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.upload(client), { code: 'STORAGE_CLEANUP_PENDING' })`; `assert.equal(f.host.snapshot().resources[0].state, 'cleanup-pending')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a missing remote multipart cleanup receipt remains charged after cancellation', async () => {
  const f = await fixture(1);
  const client = {
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: command: object。
     * 结果：返回受控对象，公开字段包括 `UploadId`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `UploadId`; the actual branch determines its shape.
     * 验证场景 / Scenario: a missing remote multipart cleanup receipt remains charged after cancellation
     * 失败 / Failure: `f.abort.signal.reason`; `new Error('remote cleanup unavailable')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `f.abort.abort`.
     */
    send: async (command: object) => {
      switch (command.constructor.name) {
        case 'CreateMultipartUploadCommand':
          return { UploadId: 'allocated' };
        case 'UploadPartCommand':
          f.abort.abort();
          throw f.abort.signal.reason;
        case 'AbortMultipartUploadCommand':
          throw new Error('remote cleanup unavailable');
        default:
          throw new Error('Unexpected ' + command.constructor.name);
      }
    },
  } as unknown as S3Client;
  try {
    await assert.rejects(f.upload(client), { code: 'STORAGE_CLEANUP_PENDING' });
    assert.equal(f.host.snapshot().resources[0].state, 'cleanup-pending');
    assert.equal(f.host.snapshot().resources[0].cost['io.buffers'], OBJECT_UPLOAD_BUFFERS);
  } finally {
    await f.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lost multipart completion response reconciles both the upload and an already committed object
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.upload`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.upload(client), /lost completion response/)`; `assert.deepEqual(calls.slice(-2), ['AbortMultipartUploadCommand', 'DeleteObjectCommand'])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('lost multipart completion response reconciles both the upload and an already committed object', async () => {
  const f = await fixture(1),
    calls: string[] = [];
  const client = {
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: command: object。
     * 结果：返回受控对象，公开字段包括 `UploadId, ETag`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `UploadId, ETag`; the actual branch determines its shape.
     * 验证场景 / Scenario: lost multipart completion response reconciles both the upload and an already committed object
     * 失败 / Failure: `new Error('lost completion response')`; `Object.assign(new Error('gone'), { name: 'NoSuchUpload' })`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `calls.push`, `Object.assign`.
     */
    send: async (command: object) => {
      calls.push(command.constructor.name);
      switch (command.constructor.name) {
        case 'CreateMultipartUploadCommand':
          return { UploadId: 'allocated' };
        case 'UploadPartCommand':
          return { ETag: 'part' };
        case 'CompleteMultipartUploadCommand':
          throw new Error('lost completion response');
        case 'AbortMultipartUploadCommand':
          throw Object.assign(new Error('gone'), { name: 'NoSuchUpload' });
        case 'DeleteObjectCommand':
          return {};
        default:
          throw new Error('Unexpected ' + command.constructor.name);
      }
    },
  } as unknown as S3Client;
  try {
    await assert.rejects(f.upload(client), /lost completion response/);
    assert.deepEqual(calls.slice(-2), ['AbortMultipartUploadCommand', 'DeleteObjectCommand']);
    assert.equal(f.host.snapshot().resources.length, 0);
  } finally {
    await f.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lost multipart allocation response checks only the exact unpublished key before releasing admission
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.upload`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.upload(client), /lost allocation response/)`; `assert.deepEqual(aborted, ['orphan'])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('lost multipart allocation response checks only the exact unpublished key before releasing admission', async () => {
  const f = await fixture(1),
    aborted: string[] = [];
  const client = {
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: command: { input: { Key?: string; UploadId?: string } }。
     * 结果：返回受控对象，公开字段包括 `Uploads`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `Uploads`; the actual branch determines its shape.
     * 验证场景 / Scenario: lost multipart allocation response checks only the exact unpublished key before releasing admission
     * 失败 / Failure: `new Error('lost allocation response')`; `new Error('Unexpected ' + command.constructor.name)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `aborted.push`.
     */
    send: async (command: { input: { Key?: string; UploadId?: string } }) => {
      switch (command.constructor.name) {
        case 'CreateMultipartUploadCommand':
          throw new Error('lost allocation response');
        case 'ListMultipartUploadsCommand':
          return {
            Uploads: [
              { Key: 'backup/new/data', UploadId: 'orphan' },
              { Key: 'backup/new/data-other', UploadId: 'unrelated' },
            ],
          };
        case 'AbortMultipartUploadCommand':
          aborted.push(command.input.UploadId!);
          return {};
        default:
          throw new Error('Unexpected ' + command.constructor.name);
      }
    },
  } as unknown as S3Client;
  try {
    await assert.rejects(f.upload(client), /lost allocation response/);
    assert.deepEqual(aborted, ['orphan']);
    assert.equal(f.host.snapshot().resources.length, 0);
  } finally {
    await f.close();
  }
});
