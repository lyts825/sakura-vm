/**
 * 模块职责：提供本地 JSON 存储与目录检查，原子写入及串行化由元数据层处理。
 */
import { readFile, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, isAbsolute, resolve } from 'node:path';
import { serializedMetadata } from './metadata-queue.ts';
import { atomicMetadataWrite } from './metadata-io.ts';
import { AppError } from '../shared/errors.ts';

/** 不等待已准入变更，直接读取最后一次原子发布的 JSON，便于持有其他领域租约时重查授权。
 * 该读取不能用于无锁的读改写，变更仍需同文件串行化和对应领域校验。 */
export async function readCommittedStore<T>(file: string, fallback: () => T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return fallback();
  }
}
export async function readStore<T>(file: string, fallback: () => T): Promise<T> {
  const target = resolve(file);
  return serializedMetadata(target, false, () => readCommittedStore(target, fallback));
}
export async function writeStore(file: string, value: unknown) {
  // 入队前同步序列化，避免调用方后续改变同一对象而使已提交队列的内容随之变化。
  const contents = JSON.stringify(value, null, 2);
  if (contents === undefined) throw new TypeError('Metadata must be JSON serializable');
  const target = resolve(file);
  return serializedMetadata(target, true, (mark) => atomicMetadataWrite(target, contents, undefined, mark));
}

export function within(root: string, target: string) {
  const path = relative(resolve(root), resolve(target));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}
export async function regularDirectory(path: string) {
  if (!isAbsolute(path) || /[\x00-\x1f]/.test(path)) throw new AppError('需要本机绝对目录路径');
  let current = resolve(path);
  while (true) {
    const info = await lstat(current).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isDirectory() || info.isSymbolicLink()))
      throw new AppError('目录不能包含符号链接或目录联接');
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(path);
}
export async function fileHash(file: string, signal?: AbortSignal) {
  const hash = createHash('sha256');
  const input = createReadStream(file, { signal });
  try {
    for await (const chunk of input) hash.update(chunk);
  } finally {
    input.destroy();
    await finished(input).catch(() => {});
  }
  return hash.digest('hex');
}
