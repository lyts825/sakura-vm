/**
 * 模块职责：写入实例身份文件并验证目录复制，拒绝链接和特殊文件进入存储迁移。
 * Module purpose: Writes VM identity files and verifies copied directories, refusing links/special files in storage migration.
 */
import { writeFile, rename, rm, readdir, mkdir, lstat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../shared/errors.ts';
import { fileHash } from './local-store.ts';
import { storageGrowth, type StorageLease } from './storage-runtime.ts';

/**
 * 入口 / Entry: writeIdentityFile.
 * 功能：在写入实例身份文件并验证目录复制中，校验并提交领域状态变更；完成下述调用及状态处理（`vm-storage.ts`）。
 * Purpose: Validates and commits a domain state change in `vm-storage.ts`; the calls and state transitions below complete the operation. Module context: Writes VM identity files and verifies copied directories, refusing links/special files in storage migration.
 * 处理：通过 `writeFile`, `rename`, `rm` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `writeFile`, `rename`, `rm`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: string; contents: string | Buffer
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `writeFile`; `rename`; `rm`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 收尾：退出 try 区域时始终执行 `await rm(temporary, { force: true });`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `await rm(temporary, { force: true });`; these steps also apply to exceptional exits.
 */
export async function writeIdentityFile(file: string, contents: string | Buffer) {
  const temporary = `${file}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flush: true });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * 入口 / Entry: directoryEntries.
 * 功能：在写入实例身份文件并验证目录复制中，执行此领域的具体处理步骤并返回其结果；本入口产生 `found.sort()` 供上层消费（`vm-storage.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-storage.ts`; this entry produces `found.sort()` for its caller. Module context: Writes VM identity files and verifies copied directories, refusing links/special files in storage migration.
 * 处理：通过 `visit`, `found.sort` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `visit`, `found.sort`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: root: string
 * 输出 / Returns: Promise<string[]>；结果来自 / values from `found.sort()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
async function directoryEntries(root: string): Promise<string[]> {
  const found: string[] = [];
  /**
   * 入口 / Entry: directoryEntries.visit.
   * 功能：在写入实例身份文件并验证目录复制中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`vm-storage.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-storage.ts`; the calls and state transitions below complete the operation. Module context: Writes VM identity files and verifies copied directories, refusing links/special files in storage migration.
   * 处理：通过 `readdir`, `entry.isDirectory`, `found.push`, `visit` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readdir`, `entry.isDirectory`, `found.push`, `visit`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `entry.isDirectory()`; `entry.isFile()`.
   * 输入 / Inputs: folder: string; prefix: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `found.push`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('实例目录包含无法迁移的链接或特殊文件', 409)`.
   */
  const visit = async (folder: string, prefix: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const relativePath = prefix + entry.name;
      if (entry.isDirectory()) {
        found.push(relativePath + '/');
        await visit(join(folder, entry.name), relativePath + '/');
      } else if (entry.isFile()) found.push(relativePath);
      else throw new AppError('实例目录包含无法迁移的链接或特殊文件', 409);
    }
  };
  await visit(root, '');
  return found.sort();
}

/**
 * 入口 / Entry: copyDirectoryVerified.
 * 功能：在写入实例身份文件并验证目录复制中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`vm-storage.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-storage.ts`; the calls and state transitions below complete the operation. Module context: Writes VM identity files and verifies copied directories, refusing links/special files in storage migration.
 * 处理：通过 `directoryEntries`, `mkdir`, `visit` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `directoryEntries`, `mkdir`, `visit`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: source: string; destination: string; signal: AbortSignal optional; progress: (text: string) => void default=() => {}; lease: StorageLease optional
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `mkdir`.
 * 拒绝 / Refusals: 条件 / conditions `JSON.stringify(before) !== JSON.stringify(await directoryEntries(source)) || JSON.stringify(before) !== JSON.stringify(await …`; 异常 / errors `new AppError('迁移期间实例目录发生变化', 409)`.
 */
export async function copyDirectoryVerified(
  source: string,
  destination: string,
  signal?: AbortSignal,
  progress: (text: string) => void = () => {},
  lease?: StorageLease,
) {
  const before = await directoryEntries(source);
  await mkdir(destination);
  /**
   * 入口 / Entry: copyDirectoryVerified.visit.
   * 功能：在写入实例身份文件并验证目录复制中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`vm-storage.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-storage.ts`; the calls and state transitions below complete the operation. Module context: Writes VM identity files and verifies copied directories, refusing links/special files in storage migration.
   * 处理：通过 `readdir`, `signal.throwIfAborted`, `join`, `entry.isDirectory` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readdir`, `signal.throwIfAborted`, `join`, `entry.isDirectory`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `entry.isDirectory()`; `lease`.
   * 输入 / Inputs: folder: string; target: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `mkdir`; `createHash`; `createReadStream`; `createWriteStream`.
   * 拒绝 / Refusals: 条件 / conditions `entry.isFile()`; `checksum.digest('hex') !== destinationHash`; `after.size !== sourceInfo.size || after.mtimeMs !== sourceInfo.mtimeMs`; 异常 / errors `new AppError(`存储池迁移校验失败：${entry.name}`, 409)`; `new AppError(`迁移期间源文件发生变化：${entry.name}`, 409)`.
   */
  const visit = async (folder: string, target: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const input = join(folder, entry.name),
        output = join(target, entry.name);
      if (entry.isDirectory()) {
        await mkdir(output);
        await visit(input, output);
      } else if (entry.isFile()) {
        const sourceInfo = await lstat(input);
        const checksum = createHash('sha256');
        if (lease) await lease.reserveTemporary(output, sourceInfo.size);
        await pipeline(
          createReadStream(input, { signal }),
          new Transform({
            /**
             * 入口 / Entry: copyDirectoryVerified.transform.
             * 功能：在写入实例身份文件并验证目录复制中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`vm-storage.ts`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-storage.ts`; the calls and state transitions below complete the operation. Module context: Writes VM identity files and verifies copied directories, refusing links/special files in storage migration.
             * 处理：通过 `checksum.update`, `callback` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `checksum.update`, `callback`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: chunk; _encoding; callback
             * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
             * 副作用 / Effects: `checksum.update`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            transform(chunk, _encoding, callback) {
              checksum.update(chunk);
              callback(null, chunk);
            },
          }),
          ...(lease ? [storageGrowth(lease, output, sourceInfo.size)] : []),
          createWriteStream(output, { flags: 'wx', mode: sourceInfo.mode & 0o777 }),
          { signal },
        );
        const destinationHash = await fileHash(output, signal);
        if (checksum.digest('hex') !== destinationHash)
          throw new AppError(`存储池迁移校验失败：${entry.name}`, 409);
        const after = await lstat(input);
        if (after.size !== sourceInfo.size || after.mtimeMs !== sourceInfo.mtimeMs)
          throw new AppError(`迁移期间源文件发生变化：${entry.name}`, 409);
        progress(`已校验 ${entry.name}（${after.size} 字节）\n`);
      } else throw new AppError('实例目录包含无法迁移的链接或特殊文件', 409);
    }
  };
  await visit(source, destination);
  if (
    JSON.stringify(before) !== JSON.stringify(await directoryEntries(source)) ||
    JSON.stringify(before) !== JSON.stringify(await directoryEntries(destination))
  )
    throw new AppError('迁移期间实例目录发生变化', 409);
}
