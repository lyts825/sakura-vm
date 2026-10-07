/**
 * 模块职责：流式加解密备份并提供临时明文作用域，验证文件边界与认证结果后才导入。
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
async function derive(password: string, salt: Buffer) {
  passwordSchema.parse(password);
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
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
export async function importEncrypted(
  bundles: BundlesV1,
  name: string,
  source: Readable,
  password: string,
  signal: AbortSignal,
) {
  passwordSchema.parse(password);
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
