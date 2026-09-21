import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, open, stat, mkdtemp, rm, rmdir } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import { join } from 'node:path';
import { z } from 'zod';
import { DATA, AppError } from './model.ts';
import { regularDirectory } from './local-store.ts';
import type { Bundles } from './bundles.ts';

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
) {
  const header = Buffer.concat([MAGIC, randomBytes(16), randomBytes(12)]),
    key = await derive(password, header.subarray(8, 24));
  try {
    const cipher = createCipheriv('aes-256-gcm', key, header.subarray(24));
    cipher.setAAD(header);
    const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
    output.write(header);
    await pipeline(createReadStream(source), cipher, output, { signal });
    await appendFile(destination, cipher.getAuthTag());
  } finally {
    key.fill(0);
  }
}
export async function decryptFile(
  source: string,
  destination: string,
  password: string,
  signal?: AbortSignal,
) {
  const size = (await stat(source)).size;
  if (size < HEADER_SIZE + TAG_SIZE || size > 33 * 1024 ** 3) throw new AppError('加密备份大小无效');
  const file = await open(source, 'r'),
    header = Buffer.alloc(HEADER_SIZE),
    tag = Buffer.alloc(TAG_SIZE);
  try {
    await file.read(header, 0, header.length, 0);
    await file.read(tag, 0, tag.length, size - tag.length);
  } finally {
    await file.close();
  }
  if (!header.subarray(0, 8).equals(MAGIC)) throw new AppError('不是 Sakura 加密备份');
  const key = await derive(password, header.subarray(8, 24));
  let destinationHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
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
      await destinationHandle.close();
      await rm(destination, { force: true });
    }
    signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw error;
    throw new AppError('密码错误或加密备份已损坏');
  } finally {
    key.fill(0);
    await destinationHandle?.close();
  }
}
export async function withDecrypted<T>(
  source: string,
  password: string,
  work: (file: string) => Promise<T>,
  signal?: AbortSignal,
) {
  await regularDirectory(DATA);
  const dir = await mkdtemp(join(DATA, '.decrypt-')),
    file = join(dir, 'backup.sakura');
  try {
    await decryptFile(source, file, password, signal);
    return await work(file);
  } finally {
    await rm(file, { force: true });
    await rmdir(dir);
  }
}
export async function importEncrypted(
  bundles: Bundles,
  name: string,
  source: Readable,
  password: string,
  signal: AbortSignal,
) {
  passwordSchema.parse(password);
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
      createWriteStream(file, { flags: 'wx', mode: 0o600 }),
      { signal },
    );
    return await withDecrypted(
      file,
      password,
      (plain) => bundles.import(name, createReadStream(plain), signal),
      signal,
    );
  } finally {
    await rm(file, { force: true });
    await rmdir(dir);
  }
}
