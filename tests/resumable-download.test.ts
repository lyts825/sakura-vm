/**
 * 模块职责：回归验证模块，围绕 `resumable-download` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `resumable-download`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: downloads resume verified local chunks after interruption and never overwrite an existing output; a changed remote manifest refuses to reuse a partial download.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { downloadManifest } from '../server/file-chunks.ts';
import { resumableDownload } from '../scripts/resumable-download.mjs';

const root = await mkdtemp(join(tmpdir(), 'sakura-download-test-'));
after(() => rm(root, { recursive: true, force: true }));
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
 * 验证场景 / Scenario: downloads resume verified local chunks after interruption and never overwrite an existing output
 * 状态影响 / State effects: `fail`, `requests`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Buffer.concat`, `Buffer.alloc`, `Buffer.from`, `downloadManifest`.
 * 检查边界 / Checked boundaries: `assert.equal(manifest.sha256, sha(data))`; `assert.equal(manifest.chunks.length, 3)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('downloads resume verified local chunks after interruption and never overwrite an existing output', async () => {
  const data = Buffer.concat([Buffer.alloc(1024 ** 2, 3), Buffer.alloc(1024 ** 2, 8), Buffer.from('tail')]);
  const manifest = await downloadManifest(
    {
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: _id: string; _path: string; target: any; headers: any。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: downloads resume verified local chunks after interruption and never overwrite an existing output
       * 协作入口 / Collaborators: `headers`, `pipeline`, `Readable.from`, `data.subarray`.
       */
      download: async (_id: string, _path: string, target: any, headers: any) => {
        headers(data.length);
        await pipeline(Readable.from([data.subarray(0, 100), data.subarray(100)]), target);
      },
    } as any,
    'vm',
    '/file',
    new AbortController().signal,
  );
  assert.equal(manifest.sha256, sha(data));
  assert.equal(manifest.chunks.length, 3);
  let fail = true,
    requests: number[] = [];
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: path: string。
   * 结果：返回受控对象，公开字段包括 `index, data, sha256`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `index, data, sha256`; the actual branch determines its shape.
   * 验证场景 / Scenario: downloads resume verified local chunks after interruption and never overwrite an existing output
   * 失败 / Failure: `new Error('connection lost')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `Number`, `url.searchParams.get`, `url.searchParams.has`, `requests.push`.
   */
  const api = async (path: string) => {
    const url = new URL('http://localhost' + path),
      index = Number(url.searchParams.get('chunk'));
    if (!url.searchParams.has('chunk')) return manifest;
    requests.push(index);
    if (fail && index === 1) throw new Error('connection lost');
    const bytes = data.subarray(
      index * manifest.chunkBytes,
      Math.min(data.length, (index + 1) * manifest.chunkBytes),
    );
    return { index, data: bytes.toString('base64'), sha256: sha(bytes) };
  };
  const output = join(root, 'download.bin');
  await assert.rejects(resumableDownload(api, 'vm', '/file', output), /connection lost/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
  assert.equal((await readFile(output + '.sakura-part')).length, manifest.chunkBytes);
  fail = false;
  requests = [];
  const result = await resumableDownload(api, 'vm', '/file', output);
  assert.deepEqual(requests, [1, 2]);
  assert.equal(result.reusedChunks, 1);
  assert.deepEqual(await readFile(output), data);
  await assert.rejects(readFile(output + '.sakura-part.json'), { code: 'ENOENT' });
  await assert.rejects(resumableDownload(api, 'vm', '/file', output), /拒绝覆盖/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a changed remote manifest refuses to reuse a partial download
 * 协作入口 / Collaborators: `Buffer.from`, `join`, `sha`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.rejects( resumableDownload(async () => ({ ...manifest, sha256: 'a'.repeat(64) }), 'vm', '/file', output), /远端文件已变化/, )`; `assert.deepEqual(await readFile(output + '.sakura-part'), data)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a changed remote manifest refuses to reuse a partial download', async () => {
  const data = Buffer.from('previous'),
    output = join(root, 'changed.bin');
  const manifest = {
    path: '/file',
    size: data.length,
    chunkBytes: 1024 ** 2,
    sha256: sha(data),
    chunks: [sha(data)],
  };
  await writeFile(output + '.sakura-part.json', JSON.stringify({ vmId: 'vm', path: '/file', manifest }));
  await writeFile(output + '.sakura-part', data);
  await assert.rejects(
    resumableDownload(async () => ({ ...manifest, sha256: 'a'.repeat(64) }), 'vm', '/file', output),
    /远端文件已变化/,
  );
  assert.deepEqual(await readFile(output + '.sakura-part'), data);
});
