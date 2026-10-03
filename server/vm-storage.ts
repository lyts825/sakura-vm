import { writeFile, rename, rm, readdir, mkdir, lstat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../shared/errors.ts';
import { fileHash } from './local-store.ts';
import { storageGrowth, type StorageLease } from './storage-runtime.ts';

export async function writeIdentityFile(file: string, contents: string | Buffer) {
  const temporary = `${file}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flush: true });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function directoryEntries(root: string): Promise<string[]> {
  const found: string[] = [];
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

export async function copyDirectoryVerified(
  source: string,
  destination: string,
  signal?: AbortSignal,
  progress: (text: string) => void = () => {},
  lease?: StorageLease,
) {
  const before = await directoryEntries(source);
  await mkdir(destination);
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
