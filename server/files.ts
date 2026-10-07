/**
 * 模块职责：封装客户机文件读取、上传及修改，约束可变路径并保留替换文件所需的元数据。
 * Module purpose: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
 */
import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SFTPWrapper, Stats } from 'ssh2';
import { AppError } from '../shared/errors.ts';
import { guestPath } from '../shared/paths.ts';
import { previewFile } from './file-preview.ts';
import { previewInWorker } from './file-preview-runtime.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { ResumableUploads } from './resumable-uploads.ts';

export const MAX_TRANSFER = 2 * 1024 ** 3;
export const MAX_TEXT_BYTES = 1024 ** 2;
/**
 * 入口 / Entry: textVersion.
 * 功能：在封装客户机文件读取、上传及修改中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(content, 'utf8').digest('hex')` 供上层消费（`files.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `files.ts`; this entry produces `createHash('sha256').update(content, 'utf8').digest('hex')` for its caller. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: content: string
 * 输出 / Returns: `createHash('sha256').update(content, 'utf8').digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const textVersion = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
export { quote } from './shell.ts';
/**
 * 入口 / Entry: ftpStat.
 * 功能：从当前输入或状态计算 `new Promise<Stats | null>((resolve, reject) => ftp.lstat(path, (err, attrs) => err ? ((err as Error & { code?: number }).code…`，供调用方后续验证或使用。
 * Purpose: Computes `new Promise<Stats | null>((resolve, reject) => ftp.lstat(path, (err, attrs) => err ? ((err as Error & { code?: number }).code…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: ftp: SFTPWrapper; path: string
 * 输出 / Returns: `new Promise<Stats | null>((resolve, reject) => ftp.lstat(path, (err, attrs) => err ? ((err as Error & { code?: number }).code…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export const ftpStat = (ftp: SFTPWrapper, path: string) =>
  new Promise<Stats | null>((resolve, reject) =>
    ftp.lstat(path, (err, attrs) =>
      err ? ((err as Error & { code?: number }).code === 2 ? resolve(null) : reject(err)) : resolve(attrs),
    ),
  );
/**
 * 入口 / Entry: mutablePath.
 * 功能：在封装客户机文件读取、上传及修改中，执行此领域的具体处理步骤并返回其结果；本入口产生 `normalized` 供上层消费（`files.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `files.ts`; this entry produces `normalized` for its caller. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
 * 处理：通过 `posix.normalize`, `guestPath` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `posix.normalize`, `guestPath`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: path: string
 * 输出 / Returns: `normalized`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `normalized === '/'`; 异常 / errors `new AppError('不能修改根目录')`.
 */
export function mutablePath(path: string) {
  const normalized = posix.normalize(guestPath(path));
  if (normalized === '/') throw new AppError('不能修改根目录');
  return normalized;
}
/**
 * 入口 / Entry: preserveFileMetadata.
 * 功能：在封装客户机文件读取、上传及修改中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`files.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `files.ts`; the calls and state transitions below complete the operation. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
 * 输入 / Inputs: ftp: SFTPWrapper; path: string; attrs: Stats
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export async function preserveFileMetadata(ftp: SFTPWrapper, path: string, attrs: Stats) {
  await new Promise<void>((resolve, reject) =>
    ftp.chown(path, attrs.uid, attrs.gid, (error) => (error ? reject(error) : resolve())),
  );
  // Ownership changes can clear setuid/setgid bits, so restore permissions last.
  await new Promise<void>((resolve, reject) =>
    ftp.chmod(path, attrs.mode & 0o7777, (error) => (error ? reject(error) : resolve())),
  );
}
export class Files {
  readonly uploads: ResumableUploads = new ResumableUploads(this);
  /**
   * 签名 / Signature: Files.trash.
   * 功能：为封装客户机文件读取、上传及修改声明 trash 的输入与结果契约，所属容器为 Files。
   * Purpose: Declares the input/result contract for trash in Files. Module responsibility: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
   * 输入 / Inputs: id: string; path: string; recursive: boolean
   * 输出 / Returns: Promise<unknown>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  trash?: (id: string, path: string, recursive: boolean) => Promise<unknown>;
  /**
   * 入口 / Entry: Files.constructor.
   * 功能：建立 Files 的封装客户机文件读取、上传及修改上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Files context for this module's responsibility: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines) {}
  /**
   * 入口 / Entry: Files.downloadInfo.
   * 功能：在封装客户机文件读取、上传及修改中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ size: attrs.size }` 供上层消费（`Files`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Files`; this entry produces `{ size: attrs.size }` for its caller. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
   * 处理：通过 `ftpStat`, `guestPath`, `attrs.isFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `ftpStat`, `guestPath`, `attrs.isFile`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: ftp: SFTPWrapper; path: string
   * 输出 / Returns: `{ size: attrs.size }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!attrs?.isFile()`; `attrs.size > MAX_TRANSFER`; 异常 / errors `new AppError('请选择普通文件', 404)`; `new AppError('单文件下载最大 2 GiB', 413)`.
   */
  private async downloadInfo(ftp: SFTPWrapper, path: string) {
    const attrs = await ftpStat(ftp, guestPath(path));
    if (!attrs?.isFile()) throw new AppError('请选择普通文件', 404);
    if (attrs.size > MAX_TRANSFER) throw new AppError('单文件下载最大 2 GiB', 413);
    return { size: attrs.size };
  }
  /**
   * 入口 / Entry: Files.info.
   * 功能：把本层请求转交 `this.machines.sftp`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.sftp` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; path: string
   * 输出 / Returns: `this.machines.sftp(id, (ftp) => this.downloadInfo(ftp, path))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  info(id: string, path: string) {
    return this.machines.sftp(id, (ftp) => this.downloadInfo(ftp, path));
  }
  /**
   * 入口 / Entry: Files.chunk.
   * 功能：在封装客户机文件读取、上传及修改中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.sftp( id, async (ftp) => { const { size } = await this.downloadInfo(ftp, path), start = index * 1024 ** 2; if (…` 供上层消费（`Files`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Files`; this entry produces `this.machines.sftp( id, async (ftp) => { const { size } = await this.downloadInfo(ftp, path), start = index * 1024 ** 2; if (…` for its caller. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
   * 处理：通过 `this.machines.sftp` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.sftp`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; path: string; index: number; signal: AbortSignal
   * 输出 / Returns: `this.machines.sftp( id, async (ftp) => { const { size } = await this.downloadInfo(ftp, path), start = index * 1024 ** 2; if (…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isSafeInteger(index) || index < 0 || index >= 2048`; 异常 / errors `new AppError('分块索引无效')`.
   */
  async chunk(id: string, path: string, index: number, signal: AbortSignal) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= 2048) throw new AppError('分块索引无效');
    /**
     * 入口 / Entry: Files.chunk.callback@57.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
     * 输入 / Inputs: ftp
     * 输出 / Returns: `{ index, bytes: data.length, data: data.toString('base64'), sha256: createHash('sha256').update(data).digest('hex'), }`.
     * 副作用 / Effects: `this.downloadInfo`; `ftp.createReadStream`; `createHash().update().digest`; `createHash().update`; `createHash`.
     * 拒绝 / Refusals: 条件 / conditions `start >= size`; `data.length !== end - start`; 异常 / errors `new AppError('下载分块超出文件范围', 416)`; `new AppError('下载期间文件长度变化', 409)`.
     */
    return this.machines.sftp(
      id,
      async (ftp) => {
        const { size } = await this.downloadInfo(ftp, path),
          start = index * 1024 ** 2;
        if (start >= size) throw new AppError('下载分块超出文件范围', 416);
        const end = Math.min(size, start + 1024 ** 2),
          chunks: Buffer[] = [];
        let received = 0;
        await pipeline(
          ftp.createReadStream(path, { start, end: end - 1 }),
          new Writable({
            /**
             * 入口 / Entry: Files.chunk.write.
             * 功能：在封装客户机文件读取、上传及修改中，校验并提交领域状态变更；本入口产生 `done(new AppError('分块超过声明长度'))` 供上层消费（`Files`）。
             * Purpose: Validates and commits a domain state change in `Files`; this entry produces `done(new AppError('分块超过声明长度'))` for its caller. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
             * 处理：通过 `done`, `chunks.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `done`, `chunks.push`; the branches below determine continuation, return or refusal.
             * 分支 / Branches: `received > end - start`.
             * 输入 / Inputs: chunk; _encoding; done
             * 输出 / Returns: `done(new AppError('分块超过声明长度'))`.
             * 副作用 / Effects: `chunks.push`; 更新 / updates `received`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            write(chunk, _encoding, done) {
              received += chunk.length;
              if (received > end - start) return done(new AppError('分块超过声明长度'));
              chunks.push(Buffer.from(chunk));
              done();
            },
          }),
          { signal },
        );
        const data = Buffer.concat(chunks);
        if (data.length !== end - start) throw new AppError('下载期间文件长度变化', 409);
        return {
          index,
          bytes: data.length,
          data: data.toString('base64'),
          sha256: createHash('sha256').update(data).digest('hex'),
        };
      },
      signal,
    );
  }
  /**
   * 入口 / Entry: Files.preview.
   * 功能：把本层请求转交 `this.machines.sftp`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.sftp` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; path: string; signal: AbortSignal optional
   * 输出 / Returns: `this.machines.sftp( id, async (ftp) => { const info = await ftpStat(ftp, guestPath(path)); if (!info?.isFile()) throw new App…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async preview(id: string, path: string, signal?: AbortSignal) {
    /**
     * 入口 / Entry: Files.preview.callback@91.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
     * 输入 / Inputs: ftp
     * 输出 / Returns: `previewInWorker(`vm:${id}`, path, info.size, read, signal)`; `previewFile(path, await read(signal), info.size)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!info?.isFile()`; 异常 / errors `new AppError('请选择普通文件', 404)`.
     */
    return this.machines.sftp(
      id,
      async (ftp) => {
        const info = await ftpStat(ftp, guestPath(path));
        if (!info?.isFile()) throw new AppError('请选择普通文件', 404);
        const maximum = info.size <= 16 * 1024 ** 2 ? info.size : 4096;
        /**
         * 入口 / Entry: Files.preview.read.
         * 功能：在封装客户机文件读取、上传及修改中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `Buffer.concat(chunks)` 供上层消费（`Files`）。
         * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Files`; this entry produces `Buffer.concat(chunks)` for its caller. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
         * 处理：通过 `pipeline`, `ftp.createReadStream` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `pipeline`, `ftp.createReadStream`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `maximum`.
         * 输入 / Inputs: active: AbortSignal optional
         * 输出 / Returns: `Buffer.concat(chunks)`.
         * 副作用 / Effects: `ftp.createReadStream`.
         * 拒绝 / Refusals: 条件 / conditions `received !== maximum`; 异常 / errors `new AppError('预览期间文件长度变化', 409)`.
         */
        const read = async (active?: AbortSignal) => {
          const chunks: Buffer[] = [];
          let received = 0;
          if (maximum)
            await pipeline(
              ftp.createReadStream(path, { start: 0, end: maximum - 1 }),
              new Writable({
                /**
                 * 入口 / Entry: Files.preview.write.
                 * 功能：在封装客户机文件读取、上传及修改中，校验并提交领域状态变更；本入口产生 `done(new AppError('预览读取超过声明长度', 409))` 供上层消费（`Files`）。
                 * Purpose: Validates and commits a domain state change in `Files`; this entry produces `done(new AppError('预览读取超过声明长度', 409))` for its caller. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
                 * 处理：通过 `done`, `chunks.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
                 * Processing: Coordinates its dependencies through `done`, `chunks.push`; the branches below determine continuation, return or refusal.
                 * 分支 / Branches: `received > maximum`.
                 * 输入 / Inputs: chunk; _encoding; done
                 * 输出 / Returns: `done(new AppError('预览读取超过声明长度', 409))`.
                 * 副作用 / Effects: `chunks.push`; 更新 / updates `received`.
                 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                 */
                write(chunk, _encoding, done) {
                  received += chunk.length;
                  if (received > maximum) return done(new AppError('预览读取超过声明长度', 409));
                  chunks.push(Buffer.from(chunk)); done();
                },
              }),
              { signal: active },
            );
          if (received !== maximum) throw new AppError('预览期间文件长度变化', 409);
          return Buffer.concat(chunks);
        };
        if (info.size <= 16 * 1024 ** 2 && (maximum > 256 * 1024 || /\.(tar\.gz|tgz)$/i.test(path)))
          return previewInWorker(`vm:${id}`, path, info.size, read, signal);
        return previewFile(path, await read(signal), info.size);
      },
      signal,
    );
  }
  /**
   * 入口 / Entry: Files.upload.
   * 功能：在受管 SFTP 连接中上传文件，校验目标路径并保留适用的文件元数据。
   * Purpose: Uploads through managed SFTP after path validation while preserving applicable file metadata.
   * 设计：流、传输预算和取消共用操作边界；替换前后校验文件状态，失败收回原连接及暂存资源。
   * Design: Streams, admission and cancellation share one boundary; replacement checks and failure cleanup retain original connection/staging ownership.
   * 输入 / Inputs: id: string; path: string; source: Readable; overwrite: default=false; signal: AbortSignal optional; expectedVersion: string optional
   * 输出 / Returns: `await this.machines.sftp( id, async (ftp, transportSignal) => { // Once connected, pipeline handles cancellation while SSH st…`.
   * 副作用 / Effects: `signal.addEventListener`; 更新 / updates `path`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `signal?.removeEventListener('abort', abortConnection);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `signal?.removeEventListener('abort', abortConnection);`; these steps also apply to exceptional exits.
   */
  async upload(
    id: string,
    path: string,
    source: Readable,
    overwrite = false,
    signal?: AbortSignal,
    expectedVersion?: string,
  ) {
    signal?.throwIfAborted();
    path = mutablePath(path);
    const connection = new AbortController();
    /**
     * 入口 / Entry: Files.upload.abortConnection.
     * 功能：把本层请求转交 `connection.abort`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `connection.abort` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `connection.abort(signal?.reason)`.
     * 副作用 / Effects: `connection.abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const abortConnection = () => connection.abort(signal?.reason);
    signal?.addEventListener('abort', abortConnection, { once: true });
    try {
      /**
       * 入口 / Entry: Files.upload.callback@136.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
       * 输入 / Inputs: ftp; transportSignal
       * 输出 / Returns: `{ bytes }`.
       * 副作用 / Effects: `AbortSignal.any`; `ftp.createWriteStream`.
       * 拒绝 / Refusals: 条件 / conditions `existing && (!overwrite || !existing.isFile())`; 异常 / errors `new AppError('目标已存在；需要明确选择覆盖普通文件', 409)`.
       * 收尾：退出 try 区域时始终执行 `if (!transportSignal?.aborted) await new Promise<void>((resolve) => ftp.unlink(temp, () => resolve()));`；这些步骤也适用于异常退出。
       * Finalization: Leaving the try region always executes `if (!transportSignal?.aborted) await new Promise<void>((resolve) => ftp.unlink(temp, () => resolve()));`; these steps also apply to exceptional exits.
       */
      return await this.machines.sftp(
        id,
        async (ftp, transportSignal) => {
          // Once connected, pipeline handles cancellation while SSH stays alive
          // long enough to close the upload handle and remove its temporary file.
          signal?.removeEventListener('abort', abortConnection);
          const transferSignal =
            transportSignal && signal
              ? AbortSignal.any([signal, transportSignal])
              : transportSignal || signal;
          transferSignal?.throwIfAborted();
          const existing = await ftpStat(ftp, path);
          transferSignal?.throwIfAborted();
          if (existing && (!overwrite || !existing.isFile()))
            throw new AppError('目标已存在；需要明确选择覆盖普通文件', 409);
          /**
           * 入口 / Entry: Files.upload.checkVersion.
           * 功能：在封装客户机文件读取、上传及修改中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`Files`）。
           * Purpose: Checks admission, input or resource ownership in `Files`; this entry produces `void` for its caller. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
           * 处理：通过 `ftpStat`, `current.isFile`, `createHash`, `pipeline` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `ftpStat`, `current.isFile`, `createHash`, `pipeline`; the branches below determine continuation, return or refusal.
           * 分支 / Branches: `expectedVersion === undefined`.
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: `void`.
           * 副作用 / Effects: `createHash`; `ftp.createReadStream`.
           * 拒绝 / Refusals: 条件 / conditions `!current?.isFile() || current.size > MAX_TEXT_BYTES`; `digest.digest('hex') !== expectedVersion`; 异常 / errors `new AppError('文件已被修改或删除，请比较最新版本', 409)`; `new AppError('文件已被其他程序修改，请比较最新版本', 409)`.
           */
          const checkVersion = async () => {
            if (expectedVersion === undefined) return;
            const current = await ftpStat(ftp, path);
            if (!current?.isFile() || current.size > MAX_TEXT_BYTES)
              throw new AppError('文件已被修改或删除，请比较最新版本', 409);
            const digest = createHash('sha256');
            await pipeline(
              ftp.createReadStream(path),
              new Writable({
                /**
                 * 入口 / Entry: Files.upload.write.
                 * 功能：在封装客户机文件读取、上传及修改中，校验并提交领域状态变更；完成下述调用及状态处理（`Files`）。
                 * Purpose: Validates and commits a domain state change in `Files`; the calls and state transitions below complete the operation. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
                 * 处理：通过 `digest.update`, `cb` 协调依赖；下列分支决定是否继续、返回或拒绝。
                 * Processing: Coordinates its dependencies through `digest.update`, `cb`; the branches below determine continuation, return or refusal.
                 * 输入 / Inputs: chunk; _encoding; cb
                 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
                 * 副作用 / Effects: `digest.update`.
                 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                 */
                write(chunk, _encoding, cb) {
                  digest.update(chunk);
                  cb();
                },
              }),
              { signal: transferSignal },
            );
            if (digest.digest('hex') !== expectedVersion)
              throw new AppError('文件已被其他程序修改，请比较最新版本', 409);
          };
          await checkVersion();
          const temp = posix.join(posix.dirname(path), `.sakura-upload-${randomUUID()}`);
          let bytes = 0;
          try {
            await pipeline(
              source,
              new Transform({
                /**
                 * 入口 / Entry: Files.upload.transform.
                 * 功能：在封装客户机文件读取、上传及修改中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Files`）。
                 * Purpose: Executes the domain-specific processing steps and returns their outcome in `Files`; the calls and state transitions below complete the operation. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
                 * 处理：通过 `cb` 协调依赖；下列分支决定是否继续、返回或拒绝。
                 * Processing: Coordinates its dependencies through `cb`; the branches below determine continuation, return or refusal.
                 * 输入 / Inputs: chunk; _encoding; cb
                 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
                 * 副作用 / Effects: 更新 / updates `bytes`.
                 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                 */
                transform(chunk, _encoding, cb) {
                  bytes += chunk.length;
                  cb(bytes > MAX_TRANSFER ? new AppError('文件超过 2 GiB', 413) : null, chunk);
                },
              }),
              ftp.createWriteStream(temp, { flags: 'wx', mode: existing?.mode || 0o644 }),
              { signal: transferSignal },
            );
            if (existing) await preserveFileMetadata(ftp, temp, existing);
            if (existing) await this.machines.fileReplacing?.(id, path, ftp, transferSignal);
            await checkVersion();
            transferSignal?.throwIfAborted();
            if (overwrite)
              await new Promise<void>((res, rej) =>
                ftp.ext_openssh_rename(temp, path, (err) => (err ? rej(err) : res())),
              );
            else
              await new Promise<void>((res, rej) =>
                ftp.rename(temp, path, (err) => (err ? rej(err) : res())),
              );
            return { bytes };
          } finally {
            if (!transportSignal?.aborted)
              await new Promise<void>((resolve) => ftp.unlink(temp, () => resolve()));
          }
        },
        connection.signal,
      );
    } finally {
      signal?.removeEventListener('abort', abortConnection);
    }
  }
  /**
   * 入口 / Entry: Files.download.
   * 功能：把本层请求转交 `this.machines.sftp`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.sftp` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; path: string; target: Writable; headers: (size: number) => void; signal: AbortSignal optional
   * 输出 / Returns: `this.machines.sftp( id, async (ftp) => { const { size } = await this.downloadInfo(ftp, path); signal?.throwIfAborted(); heade…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async download(
    id: string,
    path: string,
    target: Writable,
    headers: (size: number) => void,
    signal?: AbortSignal,
  ) {
    /**
     * 入口 / Entry: Files.download.callback@216.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
     * 输入 / Inputs: ftp
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.downloadInfo`; `ftp.createReadStream`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.machines.sftp(
      id,
      async (ftp) => {
        const { size } = await this.downloadInfo(ftp, path);
        signal?.throwIfAborted();
        headers(size);
        // Bound reads to the stat result so appends cannot exceed Content-Length
        // or the transfer limit after the response headers have been selected.
        const source = size ? ftp.createReadStream(path, { start: 0, end: size - 1 }) : Readable.from([]);
        let bytes = 0;
        await pipeline(
          source,
          new Transform({
            /**
             * 入口 / Entry: Files.download.transform.
             * 功能：在封装客户机文件读取、上传及修改中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Files`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `Files`; the calls and state transitions below complete the operation. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
             * 处理：通过 `done` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `done`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: chunk: Buffer; _encoding; done
             * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
             * 副作用 / Effects: 更新 / updates `bytes`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            transform(chunk: Buffer, _encoding, done) {
              bytes += chunk.length;
              done(bytes > size ? new AppError('下载期间文件长度变化', 409) : null, chunk);
            },
            /**
             * 入口 / Entry: Files.download.flush.
             * 功能：在封装客户机文件读取、上传及修改中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Files`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `Files`; the calls and state transitions below complete the operation. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
             * 处理：通过 `done` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `done`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: done
             * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            flush(done) {
              done(bytes !== size ? new AppError('下载期间文件长度变化', 409) : null);
            },
          }),
          target,
          { signal },
        );
      },
      signal,
    );
  }
  /**
   * 入口 / Entry: Files.operation.
   * 功能：在封装客户机文件读取、上传及修改中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.trash(id, path, recursive)` / `this.machines.sftp(id, async (ftp) => { if (action === 'mkdir') await new Promise<void>((res, rej) => ftp.mkdir(path, (err) =…` 供上层消费（`Files`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Files`; this entry produces `this.trash(id, path, recursive)` / `this.machines.sftp(id, async (ftp) => { if (action === 'mkdir') await new Promise<void>((res, rej) => ftp.mkdir(path, (err) =…` for its caller. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
   * 处理：通过 `mutablePath`, `this.trash`, `this.machines.sftp` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `mutablePath`, `this.trash`, `this.machines.sftp`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `action === 'delete' && this.trash`.
   * 输入 / Inputs: id: string; action: 'mkdir' | 'rename' | 'delete'; path: string; destination: string optional; recursive: default=false
   * 输出 / Returns: `this.trash(id, path, recursive)`; `this.machines.sftp(id, async (ftp) => { if (action === 'mkdir') await new Promise<void>((res, rej) => ftp.mkdir(path, (err) =…`.
   * 副作用 / Effects: 更新 / updates `path`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async operation(
    id: string,
    action: 'mkdir' | 'rename' | 'delete',
    path: string,
    destination?: string,
    recursive = false,
  ) {
    path = mutablePath(path);
    if (action === 'delete' && this.trash) return this.trash(id, path, recursive);
    /**
     * 入口 / Entry: Files.operation.callback@251.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
     * 输入 / Inputs: ftp
     * 输出 / Returns: `{ ok: true }`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `action === 'rename'`; `await ftpStat(ftp, to)`; `!attrs`; 异常 / errors `new AppError('目标已存在', 409)`; `new AppError('文件不存在', 404)`.
     */
    return this.machines.sftp(id, async (ftp) => {
      if (action === 'mkdir')
        await new Promise<void>((res, rej) => ftp.mkdir(path, (err) => (err ? rej(err) : res())));
      else if (action === 'rename') {
        const to = mutablePath(destination || '');
        if (await ftpStat(ftp, to)) throw new AppError('目标已存在', 409);
        await new Promise<void>((res, rej) => ftp.rename(path, to, (err) => (err ? rej(err) : res())));
      } else {
        let count = 0;
        /**
         * 入口 / Entry: Files.operation.remove.
         * 功能：在封装客户机文件读取、上传及修改中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`Files`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `Files`; this entry produces `void` for its caller. Module context: Wraps guest file reads, uploads and mutations, constraining mutable paths and preserving replacement metadata.
         * 处理：通过 `ftpStat`, `attrs.isDirectory`, `inline.test`, `remove` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `ftpStat`, `attrs.isDirectory`, `inline.test`, `remove`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `!attrs`.
         * 输入 / Inputs: target: string
         * 输出 / Returns: Promise<void>；结果来自 / values from `void`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 拒绝 / Refusals: 条件 / conditions `++count > 20000`; `attrs.isDirectory() && recursive`; `entry.filename === '.' || entry.filename === '..' || /[\/\\]/.test(entry.filename)`; 异常 / errors `new AppError('目录超过单次删除 20000 个条目的限制')`; `new AppError('无效的目录条目')`.
         */
        const remove = async (target: string): Promise<void> => {
          if (++count > 20000) throw new AppError('目录超过单次删除 20000 个条目的限制');
          const attrs = await ftpStat(ftp, target);
          if (!attrs) return;
          if (attrs.isDirectory() && recursive) {
            const entries = await new Promise<import('ssh2').FileEntry[]>((res, rej) =>
              ftp.readdir(target, (err, entries) => (err ? rej(err) : res(entries))),
            );
            for (const entry of entries) {
              if (entry.filename === '.' || entry.filename === '..' || /[\/\\]/.test(entry.filename))
                throw new AppError('无效的目录条目');
              await remove(posix.join(target, entry.filename));
            }
          }
          await new Promise<void>((res, rej) =>
            attrs.isDirectory()
              ? ftp.rmdir(target, (err) => (err ? rej(err) : res()))
              : ftp.unlink(target, (err) => (err ? rej(err) : res())),
          );
        };
        const attrs = await ftpStat(ftp, path);
        if (!attrs) throw new AppError('文件不存在', 404);
        await remove(path);
      }
      return { ok: true };
    });
  }
}
