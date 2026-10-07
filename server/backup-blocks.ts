/**
 * 模块职责：管理不可变备份块与引用清单；下载期间持有存储锁，回收前验证全部引用。
 * Module purpose: Owns immutable backup blocks and reference manifests; locks downloads against deletion and validates references before garbage collection.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Readable, type Writable } from 'node:stream';
import { pipeline, finished } from 'node:stream/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { checkedId } from '../shared/paths.ts';
import { DATA } from './paths.ts';
import { regularDirectory, writeStore } from './local-store.ts';
import { storageRuntime } from './storage-runtime.ts';

const blockSize = 1024 * 1024;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z
  .object({
    version: z.literal(1),
    vmId: z.uuid(),
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    bytes: z
      .number()
      .int()
      .nonnegative()
      .max(129 * 1024 ** 3),
    sha256: sha,
    blockSize: z.literal(blockSize),
    chunks: z
      .array(z.object({ sha256: sha, bytes: z.number().int().min(1).max(blockSize) }).strict())
      .max(132096),
  })
  .strict();
export type BlockManifest = z.infer<typeof manifestSchema>;
/**
 * 入口 / Entry: digest.
 * 功能：在管理不可变备份块与引用清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(value).digest('hex')` 供上层消费（`backup-blocks.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `backup-blocks.ts`; this entry produces `createHash('sha256').update(value).digest('hex')` for its caller. Module context: Owns immutable backup blocks and reference manifests; locks downloads against deletion and validates references before garbage collection.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: Buffer
 * 输出 / Returns: `createHash('sha256').update(value).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');

/** Immutable content blocks shared by all local, unencrypted backups. */
export class BackupBlocks {
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * 入口 / Entry: BackupBlocks.constructor.
   * 功能：建立 BackupBlocks 的管理不可变备份块与引用清单上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the BackupBlocks context for this module's responsibility: Owns immutable backup blocks and reference manifests; locks downloads against deletion and validates references before garbage collection. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: root: default=join(DATA, 'backup-blocks')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private root = join(DATA, 'backup-blocks')) {}
  /**
   * 入口 / Entry: BackupBlocks.serial.
   * 功能：在管理不可变备份块与引用清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 `next` / `new Promise<T>((resolve, reject) => { const abort = () => { if (!started) reject(signal.reason); }; signal.addEventListener('…` 供上层消费（`BackupBlocks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BackupBlocks`; this entry produces `next` / `new Promise<T>((resolve, reject) => { const abort = () => { if (!started) reject(signal.reason); }; signal.addEventListener('…` for its caller. Module context: Owns immutable backup blocks and reference manifests; locks downloads against deletion and validates references before garbage collection.
   * 处理：通过 `this.queue.catch().then`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.queue.catch().then`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!signal`.
   * 输入 / Inputs: work: () => Promise<T>; signal: AbortSignal optional
   * 输出 / Returns: `next`; `new Promise<T>((resolve, reject) => { const abort = () => { if (!started) reject(signal.reason); }; signal.addEventListener('…`.
   * 副作用 / Effects: 更新 / updates `this.queue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>, signal?: AbortSignal) {
    let started = false;
    const next = this.queue
      .catch(() => {})
      .then(() => {
        started = true;
        signal?.throwIfAborted();
        return work();
      });
    this.queue = next;
    if (!signal) return next;
    /**
     * 入口 / Entry: BackupBlocks.serial.callback@55.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
     * 输入 / Inputs: resolve; reject
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `signal.addEventListener`; `abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return new Promise<T>((resolve, reject) => {
      /**
       * 入口 / Entry: BackupBlocks.serial.abort.
       * 功能：在管理不可变备份块与引用清单中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`BackupBlocks`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `BackupBlocks`; the calls and state transitions below complete the operation. Module context: Owns immutable backup blocks and reference manifests; locks downloads against deletion and validates references before garbage collection.
       * 处理：通过 `reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `reject`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `!started`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const abort = () => {
        if (!started) reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      next.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  /**
   * 入口 / Entry: BackupBlocks.manifestPath.
   * 功能：在管理不可变备份块与引用清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(this.root, 'manifests', checkedId(vmId), checkedId(id) + '.json')` 供上层消费（`BackupBlocks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BackupBlocks`; this entry produces `join(this.root, 'manifests', checkedId(vmId), checkedId(id) + '.json')` for its caller. Module context: Owns immutable backup blocks and reference manifests; locks downloads against deletion and validates references before garbage collection.
   * 处理：通过 `join`, `checkedId` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `checkedId`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: `join(this.root, 'manifests', checkedId(vmId), checkedId(id) + '.json')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private manifestPath(vmId: string, id: string) {
    return join(this.root, 'manifests', checkedId(vmId), checkedId(id) + '.json');
  }
  /**
   * 入口 / Entry: BackupBlocks.blockPath.
   * 功能：在管理不可变备份块与引用清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(this.root, 'chunks', sha.parse(hash).slice(0, 2), hash)` 供上层消费（`BackupBlocks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BackupBlocks`; this entry produces `join(this.root, 'chunks', sha.parse(hash).slice(0, 2), hash)` for its caller. Module context: Owns immutable backup blocks and reference manifests; locks downloads against deletion and validates references before garbage collection.
   * 处理：通过 `join`, `sha.parse().slice`, `sha.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `sha.parse().slice`, `sha.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: hash: string
   * 输出 / Returns: `join(this.root, 'chunks', sha.parse(hash).slice(0, 2), hash)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private blockPath(hash: string) {
    return join(this.root, 'chunks', sha.parse(hash).slice(0, 2), hash);
  }
  /**
   * 入口 / Entry: BackupBlocks.manifest.
   * 功能：在管理不可变备份块与引用清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value` 供上层消费（`BackupBlocks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BackupBlocks`; this entry produces `value` for its caller. Module context: Owns immutable backup blocks and reference manifests; locks downloads against deletion and validates references before garbage collection.
   * 处理：通过 `this.manifestPath`, `regularDirectory`, `dirname`, `lstat` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.manifestPath`, `regularDirectory`, `dirname`, `lstat`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; expected: string optional
   * 输出 / Returns: `value`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!info.isFile() || info.size > 32 * 1024 ** 2`; `value.vmId !== vmId || value.id !== id || (expected && value.sha256 !== expected) || value.chunks.reduce((sum, chunk) => sum …`; 异常 / errors `new AppError('备份块清单类型或大小无效')`; `new AppError('备份块清单与备份记录不符', 409)`.
   */
  private async manifest(vmId: string, id: string, expected?: string) {
    const file = this.manifestPath(vmId, id);
    await regularDirectory(dirname(file));
    const info = await lstat(file);
    if (!info.isFile() || info.size > 32 * 1024 ** 2) throw new AppError('备份块清单类型或大小无效');
    const value = manifestSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (
      value.vmId !== vmId ||
      value.id !== id ||
      (expected && value.sha256 !== expected) ||
      value.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0) !== value.bytes ||
      value.chunks.slice(0, -1).some((chunk) => chunk.bytes !== blockSize)
    )
      throw new AppError('备份块清单与备份记录不符', 409);
    return value;
  }
  /**
   * 入口 / Entry: BackupBlocks.read.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: vmId: string; id: string; expected: string optional
   * 输出 / Returns: `this.serial(() => this.manifest(vmId, id, expected))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  read(vmId: string, id: string, expected?: string) {
    return this.serial(() => this.manifest(vmId, id, expected));
  }
  /**
   * 入口 / Entry: BackupBlocks.pack.
   * 功能：把已核验备份分成内容寻址块，验证可复用块并发布整体摘要一致的块清单。
   * Purpose: Splits a verified backup into content-addressed blocks, verifies reused blocks and publishes a whole-digest-consistent manifest.
   * 设计：同一存储串行执行，块先临时落盘再重命名；全部读取及整体哈希通过后才发布引用清单。
   * Design: The store is serialized; blocks are flushed then renamed, and reference publication waits for full reads and whole-file hashing.
   * 输入 / Inputs: vmId: string; id: string; file: string; expected: string; signal: AbortSignal; onCleanupError: (error: unknown) => void optional
   * 输出 / Returns: `this.serial(async () => { signal.throwIfAborted(); const path = this.manifestPath(vmId, id); await regularDirectory(dirname(p…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async pack(vmId: string, id: string, file: string, expected: string, signal: AbortSignal,
    onCleanupError?: (error: unknown) => void) {
    /**
     * 入口 / Entry: BackupBlocks.pack.callback@91.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `value`.
     * 副作用 / Effects: `createHash`; `mkdir`; `folders.add`; `writeFile`; `rename`; 更新 / updates `offset`, `bytes`.
     * 拒绝 / Refusals: 条件 / conditions `exists`; `!info.isFile() || info.size > 129 * 1024 ** 3`; `!bytesRead`; 异常 / errors `new AppError('备份块清单已存在，拒绝覆盖', 409)`; `new AppError('备份源类型或大小无效')`.
     * 收尾：退出 try 区域时始终执行 `await handle.close();`; `try { await rm(temp, { force: true }); } catch (error) { onCleanupError?.(error); throw error; }`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `await handle.close();`; `try { await rm(temp, { force: true }); } catch (error) { onCleanupError?.(error); throw error; }`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `onCleanupError?.(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `onCleanupError?.(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.serial(async () => {
      signal.throwIfAborted();
      const path = this.manifestPath(vmId, id);
      await regularDirectory(dirname(path));
      const exists = await lstat(path).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (exists) throw new AppError('备份块清单已存在，拒绝覆盖', 409);
      const info = await lstat(file);
      if (!info.isFile() || info.size > 129 * 1024 ** 3) throw new AppError('备份源类型或大小无效');
      const handle = await open(file, 'r'),
        whole = createHash('sha256');
      const chunks: BlockManifest['chunks'] = [],
        checked = new Set<string>(),
        folders = new Set<string>();
      let bytes = 0;
      try {
        while (bytes < info.size) {
          signal.throwIfAborted();
          const buffer = Buffer.alloc(Math.min(blockSize, info.size - bytes));
          let offset = 0;
          while (offset < buffer.length) {
            const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, bytes + offset);
            if (!bytesRead) throw new AppError('备份在分块时被截断');
            offset += bytesRead;
          }
          const hash = digest(buffer),
            block = this.blockPath(hash),
            folder = dirname(block);
          if (!folders.has(folder)) {
            await regularDirectory(folder);
            await mkdir(folder, { recursive: true });
            folders.add(folder);
          }
          if (!checked.has(hash)) {
            const existing = await lstat(block).catch((error) => {
              if (error.code !== 'ENOENT') throw error;
              return null;
            });
            if (existing) {
              if (
                !existing.isFile() ||
                existing.size !== buffer.length ||
                digest(await readFile(block)) !== hash
              )
                throw new AppError('已有备份块损坏，拒绝复用：' + hash, 409);
            } else {
              const temp = block + '.' + randomUUID() + '.part';
              try {
                await writeFile(temp, buffer, { flag: 'wx', mode: 0o600, flush: true });
                signal.throwIfAborted();
                await rename(temp, block);
              } finally {
                try { await rm(temp, { force: true }); }
                catch (error) { onCleanupError?.(error); throw error; }
              }
            }
            checked.add(hash);
          }
          chunks.push({ sha256: hash, bytes: buffer.length });
          whole.update(buffer);
          bytes += buffer.length;
        }
        if ((await handle.stat()).size !== info.size) throw new AppError('备份在分块时发生变化');
      } finally {
        await handle.close();
      }
      const checksum = whole.digest('hex');
      if (checksum !== sha.parse(expected)) throw new AppError('备份分块后的整体哈希不符', 409);
      signal.throwIfAborted();
      const value: BlockManifest = {
        version: 1,
        vmId,
        id,
        createdAt: new Date().toISOString(),
        bytes,
        sha256: checksum,
        blockSize,
        chunks,
      };
      await writeStore(path, value);
      return value;
    }, signal);
  }
  /**
   * 入口 / Entry: BackupBlocks.content.
   * 功能：在管理不可变备份块与引用清单中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`BackupBlocks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BackupBlocks`; the calls and state transitions below complete the operation. Module context: Owns immutable backup blocks and reference manifests; locks downloads against deletion and validates references before garbage collection.
   * 处理：通过 `createHash`, `signal.throwIfAborted`, `this.blockPath`, `dirname` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `createHash`, `signal.throwIfAborted`, `this.blockPath`, `dirname`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!directories.has(directory)`.
   * 输入 / Inputs: value: BlockManifest; signal: AbortSignal
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `createHash`; `directories.add`; `whole.update`.
   * 拒绝 / Refusals: 条件 / conditions `!info.isFile() || info.size !== chunk.bytes`; `digest(bytes) !== chunk.sha256`; `whole.digest('hex') !== value.sha256`; 异常 / errors `new AppError('备份块缺失或大小错误：' + chunk.sha256, 409)`; `new AppError('备份块校验失败：' + chunk.sha256, 409)`.
   */
  private async *content(value: BlockManifest, signal: AbortSignal) {
    const whole = createHash('sha256'),
      directories = new Set<string>();
    for (const chunk of value.chunks) {
      signal.throwIfAborted();
      const file = this.blockPath(chunk.sha256),
        directory = dirname(file);
      if (!directories.has(directory)) {
        await regularDirectory(directory);
        directories.add(directory);
      }
      const info = await lstat(file);
      if (!info.isFile() || info.size !== chunk.bytes)
        throw new AppError('备份块缺失或大小错误：' + chunk.sha256, 409);
      const bytes = await readFile(file);
      if (digest(bytes) !== chunk.sha256) throw new AppError('备份块校验失败：' + chunk.sha256, 409);
      whole.update(bytes);
      yield bytes;
    }
    if (whole.digest('hex') !== value.sha256) throw new AppError('重组备份的整体校验失败', 409);
  }
  /**
   * 入口 / Entry: BackupBlocks.writeTo.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: vmId: string; id: string; expected: string; output: Writable; signal: AbortSignal
   * 输出 / Returns: `this.serial(async () => { signal.throwIfAborted(); const value = await this.manifest(vmId, id, expected); await pipeline(Read…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  writeTo(vmId: string, id: string, expected: string, output: Writable, signal: AbortSignal) {
    // Holding the store lock also prevents deletion/GC while a download is in flight.
    return this.serial(async () => {
      signal.throwIfAborted();
      const value = await this.manifest(vmId, id, expected);
      await pipeline(Readable.from(this.content(value, signal)), output, { signal });
    }, signal);
  }
  /**
   * 入口 / Entry: BackupBlocks.withFile.
   * 功能：在管理不可变备份块与引用清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await work(file)` 供上层消费（`BackupBlocks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BackupBlocks`; this entry produces `await work(file)` for its caller. Module context: Owns immutable backup blocks and reference manifests; locks downloads against deletion and validates references before garbage collection.
   * 处理：通过 `join`, `regularDirectory`, `mkdir`, `randomUUID` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `regularDirectory`, `mkdir`, `randomUUID`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; expected: string; signal: AbortSignal; work: (file: string) => Promise<T>; onCleanupError: (error: unknown) => void optional
   * 输出 / Returns: `await work(file)`.
   * 副作用 / Effects: `mkdir`; `createWriteStream`; `this.writeTo`; `output.destroy`; `rm`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 收尾：退出 try 区域时始终执行 `output.destroy();`; `await closed;`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `output.destroy();`; `await closed;`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `onCleanupError?.(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `onCleanupError?.(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async withFile<T>(
    vmId: string,
    id: string,
    expected: string,
    signal: AbortSignal,
    work: (file: string) => Promise<T>,
    onCleanupError?: (error: unknown) => void,
  ) {
    const directory = join(this.root, 'materialized');
    await regularDirectory(directory);
    await mkdir(directory, { recursive: true });
    const file = join(directory, randomUUID() + '.sakura');
    const output = createWriteStream(file, { flags: 'wx', mode: 0o600 });
    const closed = finished(output).catch(() => {});
    try {
      await this.writeTo(vmId, id, expected, output, signal);
      signal.throwIfAborted();
      return await work(file);
    } finally {
      output.destroy();
      await closed;
      try { await rm(file, { force: true }); }
      catch (error) { onCleanupError?.(error); throw error; }
    }
  }
  /**
   * 入口 / Entry: BackupBlocks.remove.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: `this.serial(async () => { const file = this.manifestPath(vmId, id); await regularDirectory(dirname(file)); await rm(file, { f…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  remove(vmId: string, id: string) {
    return this.serial(async () => {
      const file = this.manifestPath(vmId, id);
      await regularDirectory(dirname(file));
      await rm(file, { force: true });
    });
  }
  /**
   * 入口 / Entry: BackupBlocks.inspect.
   * 功能：遍历备份清单统计引用、物理容量和孤儿块，可按请求回收未引用内容。
   * Purpose: Traverses manifests to calculate references, physical usage and orphan blocks, optionally collecting unreferenced content.
   * 设计：先完整核验清单与引用大小及缺失块，再删除任何孤儿；损坏引用导致拒绝清理，保护有效备份。
   * Design: All references, sizes and missing blocks are checked before deletion; corrupt references refuse collection to protect valid backups.
   * 输入 / Inputs: collect: default=false; signal: AbortSignal optional
   * 输出 / Returns: `storageRuntime.run({ owner: 'core:backup-block-inspect', taskId: 'block-inspect:' + randomUUID(), label: 'Inspect immutable b…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  inspect(collect = false, signal?: AbortSignal) {
    // Admission precedes the immutable-block queue, matching every backup caller.
    /**
     * 入口 / Entry: BackupBlocks.inspect.callback@241.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ backups, logicalBytes, physicalBytes, referencedBytes, savedBytes: Math.max(0, logicalBytes - referencedBytes), orphanBytes…`.
     * 副作用 / Effects: `references.set`; `block.name.startsWith`; `orphans.push`; `found.add`; `rm`; 更新 / updates `logicalBytes`, `physicalBytes`, `orphanBytes`, `reclaimedBytes`.
     * 拒绝 / Refusals: 条件 / conditions `!machine.isDirectory()`; `references.has(chunk.sha256) && references.get(chunk.sha256) !== chunk.bytes`; `!folder.isDirectory()`; 异常 / errors `new AppError('备份清单目录不能包含链接')`; `new AppError('同一备份块包含冲突大小')`.
     */
    return storageRuntime.run({ owner: 'core:backup-block-inspect', taskId: 'block-inspect:' + randomUUID(),
      label: 'Inspect immutable backup blocks', mode: collect ? 'write' : 'read', paths: [this.root],
      buffers: 36 * 1024 ** 2, files: 3, signal }, () => this.serial(
      /**
       * 中文功能：扫描清单与块文件，验证全部引用、大小及目录类型，返回容量统计并按 collect 请求回收孤儿块。
       * English: Scans manifests/chunks, validates all references, sizes and directory types, returns capacity statistics and optionally collects orphan blocks.
       * 所属 / Owner: BackupBlocks.inspect.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       * 设计：先完成所有引用完整性检查再删除孤儿；缺失块或冲突大小必须停止清理，取消也逐文件检查。
       * Design: Validate all reference integrity before deleting orphans; missing blocks or conflicting sizes stop collection, with cancellation checked per file.
       */
      async () => {
      await regularDirectory(this.root);
      const references = new Map<string, number>();
      let logicalBytes = 0,
        backups = 0;
      const manifests = join(this.root, 'manifests');
      await regularDirectory(manifests);
      for (const machine of await readdir(manifests, { withFileTypes: true }).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return [];
      })) {
        if (!/^[a-f0-9-]{36}$/.test(machine.name)) continue;
        if (!machine.isDirectory()) throw new AppError('备份清单目录不能包含链接');
        for (const entry of await readdir(join(manifests, machine.name), { withFileTypes: true })) {
          signal?.throwIfAborted();
          if (!/^[a-f0-9-]{36}\.json$/.test(entry.name)) continue;
          const manifest = await this.manifest(machine.name, entry.name.slice(0, -5));
          logicalBytes += manifest.bytes;
          backups++;
          for (const chunk of manifest.chunks) {
            if (references.has(chunk.sha256) && references.get(chunk.sha256) !== chunk.bytes)
              throw new AppError('同一备份块包含冲突大小');
            references.set(chunk.sha256, chunk.bytes);
          }
        }
      }
      const chunks = join(this.root, 'chunks');
      await regularDirectory(chunks);
      let physicalBytes = 0,
        reclaimedBytes = 0,
        orphanBytes = 0,
        chunkCount = 0;
      const found = new Set<string>();
      const orphans: string[] = [];
      for (const folder of await readdir(chunks, { withFileTypes: true }).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return [];
      })) {
        if (!/^[a-f0-9]{2}$/.test(folder.name)) continue;
        if (!folder.isDirectory()) throw new AppError('备份块目录不能包含链接');
        for (const block of await readdir(join(chunks, folder.name), { withFileTypes: true })) {
          signal?.throwIfAborted();
          if (!/^[a-f0-9]{64}$/.test(block.name)) continue;
          if (!block.isFile() || !block.name.startsWith(folder.name))
            throw new AppError('备份块路径类型无效');
          const file = this.blockPath(block.name),
            info = await lstat(file);
          physicalBytes += info.size;
          chunkCount++;
          if (!references.has(block.name)) {
            orphanBytes += info.size;
            orphans.push(file);
          } else {
            if (references.get(block.name) !== info.size) throw new AppError('已引用备份块大小不符');
            found.add(block.name);
          }
        }
      }
      if (found.size !== references.size) throw new AppError('备份存在缺失的内容块，拒绝清理', 409);
      // Validate every manifest/reference before removing any unreferenced block.
      if (collect)
        for (const file of orphans) {
          signal?.throwIfAborted();
          await rm(file);
        }
      if (collect) {
        reclaimedBytes = orphanBytes;
        physicalBytes -= orphanBytes;
        chunkCount -= orphans.length;
        orphanBytes = 0;
      }
      const referencedBytes = [...references.values()].reduce((sum, bytes) => sum + bytes, 0);
      return {
        backups,
        logicalBytes,
        physicalBytes,
        referencedBytes,
        savedBytes: Math.max(0, logicalBytes - referencedBytes),
        orphanBytes,
        reclaimedBytes,
        chunkCount,
        blockSize,
      };
    }, signal));
  }
  /**
   * 入口 / Entry: BackupBlocks.close.
   * 功能：在管理不可变备份块与引用清单中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`BackupBlocks`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `BackupBlocks`; the calls and state transitions below complete the operation. Module context: Owns immutable backup blocks and reference manifests; locks downloads against deletion and validates references before garbage collection.
   * 处理：通过 `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    await this.queue.catch(() => {});
  }
}

let store: BackupBlocks | undefined;
/**
 * 入口 / Entry: backupBlocks.
 * 功能：在管理不可变备份块与引用清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(store ||= new BackupBlocks())` 供上层消费（`backup-blocks.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `backup-blocks.ts`; this entry produces `(store ||= new BackupBlocks())` for its caller. Module context: Owns immutable backup blocks and reference manifests; locks downloads against deletion and validates references before garbage collection.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `(store ||= new BackupBlocks())`.
 * 副作用 / Effects: 更新 / updates `store`.
 */
export function backupBlocks() {
  return (store ||= new BackupBlocks());
}
