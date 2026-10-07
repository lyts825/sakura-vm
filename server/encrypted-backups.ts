/**
 * 模块职责：流式加解密备份并提供临时明文作用域，验证文件边界与认证结果后才导入。
 * Module purpose: Streams backup encryption/decryption and temporary plaintext access, checking boundaries and authentication before import.
 */
import type { BundlesV1 } from './service-contracts/v1.ts';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, open, stat, mkdtemp, rm, rmdir } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import { join } from 'node:path';
import { z } from 'zod';
import { DATA } from './paths.ts';
import { AppError } from '../shared/errors.ts';
import { regularDirectory } from './local-store.ts';

import { storageRuntime, storageGrowth, type StorageLease } from './storage-runtime.ts';
import { randomUUID } from 'node:crypto';

const MAGIC = Buffer.from('SAKENC01'),
  HEADER_SIZE = 36,
  TAG_SIZE = 16;
export const passwordSchema = z.string().min(10, '加密密码至少 10 个字符').max(1024);
/**
 * 入口 / Entry: derive.
 * 功能：从当前输入或状态计算 `new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (erro…`，供调用方后续验证或使用。
 * Purpose: Computes `new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (erro…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: password: string; salt: Buffer
 * 输出 / Returns: `new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (erro…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
async function derive(password: string, salt: Buffer) {
  passwordSchema.parse(password);
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
/**
 * 入口 / Entry: encryptFile.
 * 功能：在流式加解密备份并提供临时明文作用域中，执行此领域的具体处理步骤并返回其结果；本入口产生 `storageRuntime.run( { owner: 'core:backup-encryption', taskId: 'encrypt:' + randomUUID(), label: 'Encrypt backup file', mode:…` 供上层消费（`encrypted-backups.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `encrypted-backups.ts`; this entry produces `storageRuntime.run( { owner: 'core:backup-encryption', taskId: 'encrypt:' + randomUUID(), label: 'Encrypt backup file', mode:…` for its caller. Module context: Streams backup encryption/decryption and temporary plaintext access, checking boundaries and authentication before import.
 * 处理：通过 `storageRuntime.run`, `randomUUID`, `lease.assertActive`, `lease.reserveTemporary` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `storageRuntime.run`, `randomUUID`, `lease.assertActive`, `lease.reserveTemporary`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!lease`.
 * 输入 / Inputs: source: string; destination: string; password: string; signal: AbortSignal optional; lease: StorageLease optional
 * 输出 / Returns: Promise<void>；结果来自 / values from `storageRuntime.run( { owner: 'core:backup-encryption', taskId: 'encrypt:' + randomUUID(), label: 'Encrypt backup file', mode:…`.
 * 副作用 / Effects: `createCipheriv`; `cipher.setAAD`; `createWriteStream`; `output.write`; `createReadStream`; 更新 / updates `complete`.
 * 拒绝 / Refusals: 条件 / conditions `owned && !complete`; 异常 / errors `error`.
 * 收尾：退出 try 区域时始终执行 `key.fill(0);`; `if (owned && !complete) { try { await rm(destination, { force: true }); } catch (error) { lease.cleanupPending(error); throw …`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `key.fill(0);`; `if (owned && !complete) { try { await rm(destination, { force: true }); } catch (error) { lease.cleanupPending(error); throw …`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `lease.cleanupPending(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `lease.cleanupPending(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function encryptFile(
  source: string,
  destination: string,
  password: string,
  signal?: AbortSignal,
  lease?: StorageLease,
): Promise<void> {
  if (!lease)
    return storageRuntime.run(
      {
        owner: 'core:backup-encryption',
        taskId: 'encrypt:' + randomUUID(),
        label: 'Encrypt backup file',
        mode: 'write',
        paths: [source, destination],
        dynamicTemporary: [destination],
        buffers: 1024 ** 2,
        files: 3,
        signal,
      },
      (owned) => encryptFile(source, destination, password, signal, owned),
    );
  lease.assertActive();
  await lease.reserveTemporary(destination, (await stat(source)).size + HEADER_SIZE + TAG_SIZE);
  const header = Buffer.concat([MAGIC, randomBytes(16), randomBytes(12)]),
    key = await derive(password, header.subarray(8, 24));
  let owned = false,
    complete = false;
  try {
    lease.assertActive();
    const cipher = createCipheriv('aes-256-gcm', key, header.subarray(24));
    cipher.setAAD(header);
    const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
    output.once('open', () => {
      owned = true;
    });
    output.write(header);
    await pipeline(createReadStream(source), cipher, output, { signal });
    await appendFile(destination, cipher.getAuthTag());
    complete = true;
  } finally {
    key.fill(0);
    if (owned && !complete) {
      try {
        await rm(destination, { force: true });
      } catch (error) {
        lease.cleanupPending(error);
        throw error;
      }
    }
  }
}
/**
 * 入口 / Entry: decryptFile.
 * 功能：在流式加解密备份并提供临时明文作用域中，执行此领域的具体处理步骤并返回其结果；本入口产生 `storageRuntime.run( { owner: 'core:backup-decryption', taskId: 'decrypt:' + randomUUID(), label: 'Decrypt backup file', mode:…` 供上层消费（`encrypted-backups.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `encrypted-backups.ts`; this entry produces `storageRuntime.run( { owner: 'core:backup-decryption', taskId: 'decrypt:' + randomUUID(), label: 'Decrypt backup file', mode:…` for its caller. Module context: Streams backup encryption/decryption and temporary plaintext access, checking boundaries and authentication before import.
 * 处理：通过 `storageRuntime.run`, `randomUUID`, `lease.assertActive`, `stat` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `storageRuntime.run`, `randomUUID`, `lease.assertActive`, `stat`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!lease`.
 * 输入 / Inputs: source: string; destination: string; password: string; signal: AbortSignal optional; lease: StorageLease optional
 * 输出 / Returns: Promise<void>；结果来自 / values from `storageRuntime.run( { owner: 'core:backup-decryption', taskId: 'decrypt:' + randomUUID(), label: 'Decrypt backup file', mode:…`.
 * 副作用 / Effects: `file.close`; `createDecipheriv`; `decipher.setAAD`; `decipher.setAuthTag`; `createReadStream`; 更新 / updates `destinationHandle`.
 * 拒绝 / Refusals: 条件 / conditions `size < HEADER_SIZE + TAG_SIZE || size > 33 * 1024 ** 3`; `!header.subarray(0, 8).equals(MAGIC)`; `destinationHandle`; 异常 / errors `new AppError('加密备份大小无效')`; `error`.
 * 收尾：退出 try 区域时始终执行 `try { await file.close(); } catch (error) { lease.cleanupPending(error); throw error; }`; `key.fill(0);`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `try { await file.close(); } catch (error) { lease.cleanupPending(error); throw error; }`; `key.fill(0);`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `lease.cleanupPending(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `lease.cleanupPending(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function decryptFile(
  source: string,
  destination: string,
  password: string,
  signal?: AbortSignal,
  lease?: StorageLease,
): Promise<void> {
  if (!lease)
    return storageRuntime.run(
      {
        owner: 'core:backup-decryption',
        taskId: 'decrypt:' + randomUUID(),
        label: 'Decrypt backup file',
        mode: 'write',
        paths: [source, destination],
        dynamicTemporary: [destination],
        buffers: 1024 ** 2,
        files: 3,
        signal,
      },
      (owned) => decryptFile(source, destination, password, signal, owned),
    );
  lease.assertActive();
  const size = (await stat(source)).size;
  if (size < HEADER_SIZE + TAG_SIZE || size > 33 * 1024 ** 3) throw new AppError('加密备份大小无效');
  await lease.reserveTemporary(destination, size - HEADER_SIZE - TAG_SIZE);
  const file = await open(source, 'r'),
    header = Buffer.alloc(HEADER_SIZE),
    tag = Buffer.alloc(TAG_SIZE);
  try {
    await file.read(header, 0, header.length, 0);
    await file.read(tag, 0, tag.length, size - tag.length);
  } finally {
    try {
      await file.close();
    } catch (error) {
      lease.cleanupPending(error);
      throw error;
    }
  }
  if (!header.subarray(0, 8).equals(MAGIC)) throw new AppError('不是 Sakura 加密备份');
  const key = await derive(password, header.subarray(8, 24));
  let destinationHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    lease.assertActive();
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(24));
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    destinationHandle = await open(destination, 'wx', 0o600);
    await pipeline(
      createReadStream(source, { start: HEADER_SIZE, end: size - TAG_SIZE - 1 }),
      decipher,
      destinationHandle.createWriteStream(),
      { signal },
    );
  } catch (error) {
    if (destinationHandle) {
      try {
        await destinationHandle.close();
        await rm(destination, { force: true });
      } catch (cleanup) {
        lease.cleanupPending(cleanup);
        throw cleanup;
      }
    }
    signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw error;
    throw new AppError('密码错误或加密备份已损坏');
  } finally {
    key.fill(0);
    try {
      await destinationHandle?.close();
    } catch (error) {
      lease.cleanupPending(error);
      throw error;
    }
  }
}
/**
 * 入口 / Entry: withDecrypted.
 * 功能：在流式加解密备份并提供临时明文作用域中，执行此领域的具体处理步骤并返回其结果；本入口产生 `storageRuntime.run( { owner: 'core:decrypted-backup', taskId: 'decrypted:' + randomUUID(), label: 'Use verified decrypted bac…` / `await work(file, lease)` 供上层消费（`encrypted-backups.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `encrypted-backups.ts`; this entry produces `storageRuntime.run( { owner: 'core:decrypted-backup', taskId: 'decrypted:' + randomUUID(), label: 'Use verified decrypted bac…` / `await work(file, lease)` for its caller. Module context: Streams backup encryption/decryption and temporary plaintext access, checking boundaries and authentication before import.
 * 处理：通过 `storageRuntime.run`, `randomUUID`, `lease.assertActive`, `regularDirectory` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `storageRuntime.run`, `randomUUID`, `lease.assertActive`, `regularDirectory`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!lease`; `!lease.pendingCleanup`.
 * 输入 / Inputs: source: string; password: string; work: (file: string, lease: StorageLease) => Promise<T>; signal: AbortSignal optional; onCleanupError: (error: unknown) => void optional; lease: StorageLease optional
 * 输出 / Returns: Promise<T>；结果来自 / values from `storageRuntime.run( { owner: 'core:decrypted-backup', taskId: 'decrypted:' + randomUUID(), label: 'Use verified decrypted bac…`; `await work(file, lease)`.
 * 副作用 / Effects: `rm`; `rmdir`; `lease.releaseTemporary`.
 * 拒绝 / Refusals: 异常 / errors `error`.
 * 收尾：退出 try 区域时始终执行 `try { await rm(file, { force: true }); await rmdir(dir); } catch (error) { lease.cleanupPending(error); onCleanupError?.(erro…`; `if (!lease.pendingCleanup) await lease.releaseTemporary(file);`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `try { await rm(file, { force: true }); await rmdir(dir); } catch (error) { lease.cleanupPending(error); onCleanupError?.(erro…`; `if (!lease.pendingCleanup) await lease.releaseTemporary(file);`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `lease.cleanupPending(error);`; `onCleanupError?.(error);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `lease.cleanupPending(error);`; `onCleanupError?.(error);`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function withDecrypted<T>(
  source: string,
  password: string,
  work: (file: string, lease: StorageLease) => Promise<T>,
  signal?: AbortSignal,
  onCleanupError?: (error: unknown) => void,
  lease?: StorageLease,
): Promise<T> {
  if (!lease)
    return storageRuntime.run(
      {
        owner: 'core:decrypted-backup',
        taskId: 'decrypted:' + randomUUID(),
        label: 'Use verified decrypted backup',
        mode: 'write',
        paths: [source, DATA],
        dynamicTemporary: [DATA],
        buffers: 20 * 1024 ** 2,
        files: 8,
        signal,
      },
      (owned) => withDecrypted(source, password, work, signal, onCleanupError, owned),
    );
  lease.assertActive();
  await regularDirectory(DATA);
  const dir = await mkdtemp(join(DATA, '.decrypt-')),
    file = join(dir, 'backup.sakura');
  try {
    await decryptFile(source, file, password, signal, lease);
    return await work(file, lease);
  } finally {
    try {
      await rm(file, { force: true });
      await rmdir(dir);
    } catch (error) {
      lease.cleanupPending(error);
      onCleanupError?.(error);
      throw error;
    }
    if (!lease.pendingCleanup) await lease.releaseTemporary(file);
  }
}
/**
 * 入口 / Entry: importEncrypted.
 * 功能：在流式加解密备份并提供临时明文作用域中，执行此领域的具体处理步骤并返回其结果；本入口产生 `storageRuntime.run( { owner: 'core:encrypted-import', taskId: 'encrypted-import:' + randomUUID(), label: 'Import encrypted ba…` 供上层消费（`encrypted-backups.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `encrypted-backups.ts`; this entry produces `storageRuntime.run( { owner: 'core:encrypted-import', taskId: 'encrypted-import:' + randomUUID(), label: 'Import encrypted ba…` for its caller. Module context: Streams backup encryption/decryption and temporary plaintext access, checking boundaries and authentication before import.
 * 处理：通过 `passwordSchema.parse`, `storageRuntime.run`, `randomUUID` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `passwordSchema.parse`, `storageRuntime.run`, `randomUUID`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: bundles: BundlesV1; name: string; source: Readable; password: string; signal: AbortSignal
 * 输出 / Returns: `storageRuntime.run( { owner: 'core:encrypted-import', taskId: 'encrypted-import:' + randomUUID(), label: 'Import encrypted ba…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function importEncrypted(
  bundles: BundlesV1,
  name: string,
  source: Readable,
  password: string,
  signal: AbortSignal,
) {
  passwordSchema.parse(password);
  /**
   * 入口 / Entry: importEncrypted.callback@223.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（storageRuntime.run）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (storageRuntime.run).
   * 输入 / Inputs: lease
   * 输出 / Returns: `await withDecrypted( file, password, (plain) => bundles.importExternal(name, createReadStream(plain), signal, lease), signal,…`.
   * 副作用 / Effects: `createWriteStream`; `rm`; `rmdir`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 收尾：退出 try 区域时始终执行 `try { await rm(file, { force: true }); await rmdir(dir); } catch (error) { lease.cleanupPending(error); throw error; }`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `try { await rm(file, { force: true }); await rmdir(dir); } catch (error) { lease.cleanupPending(error); throw error; }`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `lease.cleanupPending(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `lease.cleanupPending(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  return storageRuntime.run(
    {
      owner: 'core:encrypted-import',
      taskId: 'encrypted-import:' + randomUUID(),
      label: 'Import encrypted backup',
      mode: 'write',
      paths: [DATA],
      dynamicTemporary: [DATA],
      buffers: 24 * 1024 ** 2,
      files: 10,
      signal,
    },
    async (lease) => {
      const dir = await mkdtemp(join(DATA, '.encrypted-import-')),
        file = join(dir, 'upload.sakura.enc');
      let total = 0;
      try {
        await pipeline(
          source,
          new Transform({
            /**
             * 入口 / Entry: importEncrypted.transform.
             * 功能：在流式加解密备份并提供临时明文作用域中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`encrypted-backups.ts`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `encrypted-backups.ts`; the calls and state transitions below complete the operation. Module context: Streams backup encryption/decryption and temporary plaintext access, checking boundaries and authentication before import.
             * 处理：通过 `callback` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `callback`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: chunk: Buffer; _encoding; callback
             * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
             * 副作用 / Effects: 更新 / updates `total`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            transform(chunk: Buffer, _encoding, callback) {
              total += chunk.length;
              callback(total > 33 * 1024 ** 3 ? new AppError('加密备份最大 33 GiB') : null, chunk);
            },
          }),
          storageGrowth(lease, file, 33 * 1024 ** 3),
          createWriteStream(file, { flags: 'wx', mode: 0o600 }),
          { signal },
        );
        return await withDecrypted(
          file,
          password,
          (plain) => bundles.importExternal(name, createReadStream(plain), signal, lease),
          signal,
          lease.cleanupPending,
          lease,
        );
      } finally {
        try {
          await rm(file, { force: true });
          await rmdir(dir);
        } catch (error) {
          lease.cleanupPending(error);
          throw error;
        }
      }
    },
  );
}
