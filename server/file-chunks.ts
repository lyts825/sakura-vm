/**
 * 模块职责：按固定分块尺寸计算下载清单，检测读取期间文件长度变化以避免发布失配清单。
 * Module purpose: Hashes fixed-size download chunks, rejecting length changes during reading instead of publishing inconsistent manifests.
 */
import type { FilesV1 } from './service-contracts/v1.ts';
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { AppError } from '../shared/errors.ts';

export const DOWNLOAD_CHUNK_BYTES = 1024 ** 2;
/**
 * 入口 / Entry: downloadManifest.
 * 功能：在按固定分块尺寸计算下载清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ path, size, chunkBytes: DOWNLOAD_CHUNK_BYTES, sha256: whole.digest('hex'), chunks }` 供上层消费（`file-chunks.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `file-chunks.ts`; this entry produces `{ path, size, chunkBytes: DOWNLOAD_CHUNK_BYTES, sha256: whole.digest('hex'), chunks }` for its caller. Module context: Hashes fixed-size download chunks, rejecting length changes during reading instead of publishing inconsistent manifests.
 * 处理：通过 `createHash`, `files.download`, `chunks.push`, `createHash().update().digest` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash`, `files.download`, `chunks.push`, `createHash().update().digest`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `pending.length`.
 * 输入 / Inputs: files: FilesV1; id: string; path: string; signal: AbortSignal
 * 输出 / Returns: `{ path, size, chunkBytes: DOWNLOAD_CHUNK_BYTES, sha256: whole.digest('hex'), chunks }`.
 * 副作用 / Effects: `createHash`; `files.download`; `chunks.push`; `createHash().update().digest`; `createHash().update`.
 * 拒绝 / Refusals: 条件 / conditions `size !== expected`; 异常 / errors `new AppError('生成清单时文件长度变化，请重试', 409)`.
 */
export async function downloadManifest(files: FilesV1, id: string, path: string, signal: AbortSignal) {
  const whole = createHash('sha256'),
    chunks: string[] = [];
  let pending = Buffer.alloc(0),
    size = 0,
    expected = 0;
  await files.download(
    id,
    path,
    new Writable({
      /**
       * 入口 / Entry: downloadManifest.write.
       * 功能：在按固定分块尺寸计算下载清单中，校验并提交领域状态变更；完成下述调用及状态处理（`file-chunks.ts`）。
       * Purpose: Validates and commits a domain state change in `file-chunks.ts`; the calls and state transitions below complete the operation. Module context: Hashes fixed-size download chunks, rejecting length changes during reading instead of publishing inconsistent manifests.
       * 处理：通过 `whole.update`, `chunks.push`, `createHash().update().digest`, `createHash().update` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `whole.update`, `chunks.push`, `createHash().update().digest`, `createHash().update`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: raw: Buffer; _encoding; done
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `whole.update`; `chunks.push`; `createHash().update().digest`; `createHash().update`; `createHash`; 更新 / updates `size`, `pending`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      write(raw: Buffer, _encoding, done) {
        whole.update(raw);
        size += raw.length;
        pending = Buffer.concat([pending, raw]);
        while (pending.length >= DOWNLOAD_CHUNK_BYTES) {
          chunks.push(createHash('sha256').update(pending.subarray(0, DOWNLOAD_CHUNK_BYTES)).digest('hex'));
          pending = pending.subarray(DOWNLOAD_CHUNK_BYTES);
        }
        done();
      },
    }),
    (bytes) => {
      expected = bytes;
    },
    signal,
  );
  if (size !== expected) throw new AppError('生成清单时文件长度变化，请重试', 409);
  if (pending.length) chunks.push(createHash('sha256').update(pending).digest('hex'));
  return { path, size, chunkBytes: DOWNLOAD_CHUNK_BYTES, sha256: whole.digest('hex'), chunks };
}
