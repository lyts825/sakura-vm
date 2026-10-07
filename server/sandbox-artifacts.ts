/**
 * 模块职责：收集并下载沙箱产物，校验相对路径和链接目标，防止读取工作目录之外内容。
 * Module purpose: Collects/downloads selected artifacts after checking relative paths and link targets against the working directory.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, lstat, readFile, rename, rm } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { storageRuntime, storageGrowth, withStorageLease, type StorageLease } from './storage-runtime.ts';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { SANDBOX_ARTIFACT_BYTES, type SandboxArtifact } from '../shared/sandbox.ts';
import { ftpStat } from './files.ts';
import type { JobView } from '../shared/contracts/jobs.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';

export const artifactPathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !/[\\\x00-\x1f]/.test(value) &&
      value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    '产物需要工作目录内的相对文件路径，不能包含 .. 或反斜线',
  );

/** Copies only explicitly selected guest files. Host filenames are generated IDs. */
export class SandboxArtifacts {
  /**
   * 入口 / Entry: SandboxArtifacts.constructor.
   * 功能：建立 SandboxArtifacts 的收集并下载沙箱产物上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SandboxArtifacts context for this module's responsibility: Collects/downloads selected artifacts after checking relative paths and link targets against the working directory. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; directory: default=join(DATA, 'plugins', 'sandbox', 'artifacts')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private directory = join(DATA, 'plugins', 'sandbox', 'artifacts'),
  ) {}

  /** Include these destination devices in an enclosing operation's atomic admission. */
  /**
   * 入口 / Entry: SandboxArtifacts.storagePaths.
   * 功能：从当前输入或状态计算 `[this.directory]`，供调用方后续验证或使用。
   * Purpose: Computes `[this.directory]` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `[this.directory]`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  storagePaths() {
    return [this.directory];
  }

  /**
   * 入口 / Entry: SandboxArtifacts.collect.
   * 功能：从客户机工作目录复制明确选择的普通文件到生成 ID 的宿主产物目录。
   * Purpose: Copies explicitly selected guest regular files into generated-ID host artifact locations.
   * 设计：realpath、文件数和总字节先核验，链接不能逃出工作目录；流与文件关闭在收尾中等待确认。
   * Design: Realpaths/counts/bytes are checked and links cannot escape; final cleanup waits for streams/descriptors to close.
   * 输入 / Inputs: vmId: string; runId: string; cwd: string; paths: string[]; saved: (item: SandboxArtifact) => void; signal: AbortSignal; borrowed: StorageLease optional
   * 输出 / Returns: `void`; `withStorageLease( { owner: 'core:sandbox-artifacts', taskId: 'artifacts:' + runId, label: 'Collect sandbox artifacts', mode: …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async collect(
    vmId: string,
    runId: string,
    cwd: string,
    paths: string[],
    saved: (item: SandboxArtifact) => void,
    signal: AbortSignal,
    borrowed?: StorageLease,
  ) {
    if (!paths.length) return;
    z.uuid().parse(runId);
    /**
     * 入口 / Entry: SandboxArtifacts.collect.callback@67.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（withStorageLease）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (withStorageLease).
     * 输入 / Inputs: lease
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `mkdir`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return withStorageLease(
      {
        owner: 'core:sandbox-artifacts',
        taskId: 'artifacts:' + runId,
        label: 'Collect sandbox artifacts',
        mode: 'write',
        paths: [this.directory],
        dynamicTemporary: [this.directory],
        buffers: 1024 ** 2,
        files: 3,
        signal,
      },
      borrowed,
      async (lease) => {
        let total = 0;
        await mkdir(this.directory, { recursive: true });
        /**
         * 入口 / Entry: SandboxArtifacts.collect.callback@72.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
         * 输入 / Inputs: ftp; transport
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `AbortSignal.any`; `actual.startsWith`; `root.replace`; `createHash`; `ftp.createReadStream`; 更新 / updates `total`.
         * 拒绝 / Refusals: 条件 / conditions `!actual.startsWith(root.replace(/\/$/, '') + '/')`; `!attrs?.isFile()`; `total + attrs.size > SANDBOX_ARTIFACT_BYTES`; 异常 / errors `new AppError('产物链接不能指向工作目录之外')`; `new AppError('产物不存在或不是普通文件：' + path, 404)`.
         * 收尾：退出 try 区域时始终执行 `try { await rm(temporary, { force: true }); } catch (error) { lease.cleanupPending(error); throw error; }`; `if (!lease.pendingCleanup) await lease.releaseTemporary(temporary);`；这些步骤也适用于异常退出。
         * Finalization: Leaving the try region always executes `try { await rm(temporary, { force: true }); } catch (error) { lease.cleanupPending(error); throw error; }`; `if (!lease.pendingCleanup) await lease.releaseTemporary(temporary);`; these steps also apply to exceptional exits.
         * 失败处理：catch 分支执行 `lease.cleanupPending(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `lease.cleanupPending(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
         */
        await this.machines.sftp(
          vmId,
          async (ftp, transport) => {
            const combined = transport ? AbortSignal.any([signal, transport]) : signal;
            /**
             * 入口 / Entry: SandboxArtifacts.collect.realpath.
             * 功能：从当前输入或状态计算 `new Promise<string>((done, fail) => ftp.realpath(path, (error, value) => (error ? fail(error) : done(value))), )`，供调用方后续验证或使用。
             * Purpose: Computes `new Promise<string>((done, fail) => ftp.realpath(path, (error, value) => (error ? fail(error) : done(value))), )` from current inputs/state for the caller to validate or consume.
             * 输入 / Inputs: path: string
             * 输出 / Returns: `new Promise<string>((done, fail) => ftp.realpath(path, (error, value) => (error ? fail(error) : done(value))), )`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             */
            const realpath = (path: string) =>
              new Promise<string>((done, fail) =>
                ftp.realpath(path, (error, value) => (error ? fail(error) : done(value))),
              );
            const root = await realpath(cwd);
            for (const path of paths) {
              combined.throwIfAborted();
              artifactPathSchema.parse(path);
              const actual = await realpath(posix.join(root, path));
              if (!actual.startsWith(root.replace(/\/$/, '') + '/'))
                throw new AppError('产物链接不能指向工作目录之外');
              const attrs = await ftpStat(ftp, actual);
              if (!attrs?.isFile()) throw new AppError('产物不存在或不是普通文件：' + path, 404);
              if (total + attrs.size > SANDBOX_ARTIFACT_BYTES)
                throw new AppError('每次执行的产物总量最多 8 MiB', 413);
              const id = randomUUID(),
                file = join(this.directory, `${runId}.${id}.bin`),
                temporary = file + '.part';
              let bytes = 0;
              const hash = createHash('sha256');
              const inspect = new Transform({
                /**
                 * 入口 / Entry: SandboxArtifacts.collect.transform.
                 * 功能：在收集并下载沙箱产物中，执行此领域的具体处理步骤并返回其结果；本入口产生 `callback(new AppError('产物大小发生变化', 409))` 供上层消费（`SandboxArtifacts`）。
                 * Purpose: Executes the domain-specific processing steps and returns their outcome in `SandboxArtifacts`; this entry produces `callback(new AppError('产物大小发生变化', 409))` for its caller. Module context: Collects/downloads selected artifacts after checking relative paths and link targets against the working directory.
                 * 处理：通过 `callback`, `hash.update` 协调依赖；下列分支决定是否继续、返回或拒绝。
                 * Processing: Coordinates its dependencies through `callback`, `hash.update`; the branches below determine continuation, return or refusal.
                 * 分支 / Branches: `bytes > attrs.size || total + bytes > SANDBOX_ARTIFACT_BYTES`.
                 * 输入 / Inputs: chunk: Buffer; _encoding; callback
                 * 输出 / Returns: `callback(new AppError('产物大小发生变化', 409))`.
                 * 副作用 / Effects: `hash.update`; 更新 / updates `bytes`.
                 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                 */
                transform(chunk: Buffer, _encoding, callback) {
                  bytes += chunk.length;
                  if (bytes > attrs.size || total + bytes > SANDBOX_ARTIFACT_BYTES)
                    return callback(new AppError('产物大小发生变化', 409));
                  hash.update(chunk);
                  callback(null, chunk);
                },
              });
              try {
                await pipeline(
                  attrs.size
                    ? ftp.createReadStream(actual, { start: 0, end: attrs.size - 1 })
                    : Readable.from([]),
                  inspect,
                  storageGrowth(lease, temporary, SANDBOX_ARTIFACT_BYTES),
                  createWriteStream(temporary, { flags: 'wx', mode: 0o600, flush: true }),
                  { signal: combined },
                );
                if (bytes !== attrs.size) throw new AppError('产物读取不完整：' + path, 409);
                combined.throwIfAborted();
                await rename(temporary, file);
                saved({ id, name: posix.basename(path), path, bytes, sha256: hash.digest('hex') });
                total += bytes;
              } finally {
                try {
                  await rm(temporary, { force: true });
                } catch (error) {
                  lease.cleanupPending(error);
                  throw error;
                }
                if (!lease.pendingCleanup) await lease.releaseTemporary(temporary);
              }
            }
          },
          signal,
        );
      },
    );
  }

  /**
   * 入口 / Entry: SandboxArtifacts.download.
   * 功能：在收集并下载沙箱产物中，执行此领域的具体处理步骤并返回其结果；本入口产生 `storageRuntime.run( { owner: 'core:sandbox-artifact-read', taskId: 'artifact-read:' + randomUUID(), label: 'Read sandbox arti…` 供上层消费（`SandboxArtifacts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SandboxArtifacts`; this entry produces `storageRuntime.run( { owner: 'core:sandbox-artifact-read', taskId: 'artifact-read:' + randomUUID(), label: 'Read sandbox arti…` for its caller. Module context: Collects/downloads selected artifacts after checking relative paths and link targets against the working directory.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `job.execution.artifacts.find`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `job.execution.artifacts.find`, `join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: job: JobView | undefined; artifactId: string
   * 输出 / Returns: `storageRuntime.run( { owner: 'core:sandbox-artifact-read', taskId: 'artifact-read:' + randomUUID(), label: 'Read sandbox arti…`.
   * 副作用 / Effects: `job.execution.artifacts.find`.
   * 拒绝 / Refusals: 条件 / conditions `!job?.id`; `!artifact`; 异常 / errors `new AppError('执行记录不存在或已过期', 404)`; `new AppError('产物不存在或执行记录已过期', 404)`.
   */
  async download(job: JobView | undefined, artifactId: string) {
    z.uuid().parse(artifactId);
    if (!job?.id) throw new AppError('执行记录不存在或已过期', 404);
    const runId = z.uuid().parse(job?.id);
    const artifact = job?.execution?.artifacts.find((item) => item.id === artifactId);
    if (!artifact) throw new AppError('产物不存在或执行记录已过期', 404);
    const file = join(this.directory, `${runId}.${artifactId}.bin`);
    /**
     * 入口 / Entry: SandboxArtifacts.download.callback@152.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（storageRuntime.run）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (storageRuntime.run).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ ...artifact, base64: data.toString('base64') }`.
     * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
     * 拒绝 / Refusals: 条件 / conditions `!info.isFile() || info.size > SANDBOX_ARTIFACT_BYTES || info.size !== artifact.bytes`; `data.length !== artifact.bytes || createHash('sha256').update(data).digest('hex') !== artifact.sha256`; 异常 / errors `new AppError('产物校验失败：文件长度无效', 409)`; `new AppError('产物校验失败', 409)`.
     */
    return storageRuntime.run(
      {
        owner: 'core:sandbox-artifact-read',
        taskId: 'artifact-read:' + randomUUID(),
        label: 'Read sandbox artifact',
        mode: 'read',
        paths: [file],
        buffers: SANDBOX_ARTIFACT_BYTES * 3,
        files: 1,
      },
      async () => {
        const info = await lstat(file);
        if (!info.isFile() || info.size > SANDBOX_ARTIFACT_BYTES || info.size !== artifact.bytes)
          throw new AppError('产物校验失败：文件长度无效', 409);
        const data = await readFile(file).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('产物文件已不可用', 404);
          throw error;
        });
        if (
          data.length !== artifact.bytes ||
          createHash('sha256').update(data).digest('hex') !== artifact.sha256
        )
          throw new AppError('产物校验失败', 409);
        return { ...artifact, base64: data.toString('base64') };
      },
    );
  }

  /**
   * 入口 / Entry: SandboxArtifacts.prune.
   * 功能：在收集并下载沙箱产物中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`SandboxArtifacts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SandboxArtifacts`; the calls and state transitions below complete the operation. Module context: Collects/downloads selected artifacts after checking relative paths and link targets against the working directory.
   * 处理：通过 `jobs.map`, `readdir().catch`, `readdir`, `inline.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `jobs.map`, `readdir().catch`, `readdir`, `inline.exec`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!entry.isFile() || !match`; `job?.status === 'running'`; `!keep`.
   * 输入 / Inputs: jobs: JobView[]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `inline.exec`; `job.execution.artifacts.some`; `rm`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async prune(jobs: JobView[]) {
    const retained = new Map(jobs.map((job) => [job.id, job]));
    const entries = await readdir(this.directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      // Only delete our flat, generated files; never follow directories or user paths.
      const match = /^([a-f0-9-]{36})\.([a-f0-9-]{36})\.bin(?:\.part)?$/.exec(entry.name);
      if (!entry.isFile() || !match) continue;
      const job = retained.get(match[1]);
      // A running collector may be between its atomic rename and metadata update.
      if (job?.status === 'running') continue;
      const keep =
        !entry.name.endsWith('.part') && job?.execution?.artifacts.some((item) => item.id === match[2]);
      if (!keep) await rm(join(this.directory, entry.name), { force: true });
    }
  }
}
