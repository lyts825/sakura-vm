import { readFile, mkdir, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, relative, isAbsolute, resolve } from 'node:path';
import { AppError } from './model.ts';

export async function readStore<T>(file: string, fallback: () => T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return fallback();
  }
}
export async function writeStore(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx', flush: true });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
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
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest('hex');
}
