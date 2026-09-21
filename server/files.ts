import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { Readable, Writable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SFTPWrapper, Stats } from 'ssh2';
import { AppError, guestPath } from './model.ts';
import type { Machines } from './machines.ts';

export const MAX_TRANSFER = 2 * 1024 ** 3;
export const MAX_TEXT_BYTES = 1024 ** 2;
export const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export const ftpStat = (ftp: SFTPWrapper, path: string) =>
  new Promise<Stats | null>((resolve, reject) =>
    ftp.lstat(path, (err, attrs) =>
      err ? ((err as Error & { code?: number }).code === 2 ? resolve(null) : reject(err)) : resolve(attrs),
    ),
  );
export function mutablePath(path: string) {
  const normalized = posix.normalize(guestPath(path));
  if (normalized === '/') throw new AppError('不能修改根目录');
  return normalized;
}
export class Files {
  constructor(private machines: Machines) {}
  private async downloadInfo(ftp: SFTPWrapper, path: string) {
    const attrs = await ftpStat(ftp, guestPath(path));
    if (!attrs?.isFile()) throw new AppError('请选择普通文件', 404);
    if (attrs.size > MAX_TRANSFER) throw new AppError('单文件下载最大 2 GiB', 413);
    return { size: attrs.size };
  }
  info(id: string, path: string) {
    return this.machines.sftp(id, (ftp) => this.downloadInfo(ftp, path));
  }
  async upload(id: string, path: string, source: Readable, overwrite = false) {
    path = mutablePath(path);
    return this.machines.sftp(id, async (ftp) => {
      const existing = await ftpStat(ftp, path);
      if (existing && (!overwrite || !existing.isFile()))
        throw new AppError('目标已存在；需要明确选择覆盖普通文件', 409);
      const temp = posix.join(posix.dirname(path), `.sakura-upload-${randomUUID()}`);
      let bytes = 0;
      try {
        await pipeline(
          source,
          new Transform({
            transform(chunk, _encoding, cb) {
              bytes += chunk.length;
              cb(bytes > MAX_TRANSFER ? new AppError('文件超过 2 GiB', 413) : null, chunk);
            },
          }),
          ftp.createWriteStream(temp, { flags: 'wx', mode: existing?.mode || 0o644 }),
        );
        if (existing) {
          await new Promise<void>((res, rej) =>
            ftp.chown(temp, existing.uid, existing.gid, (err) => (err ? rej(err) : res())),
          );
          // Apply the full permissions after chown, which can clear setuid/setgid bits.
          await new Promise<void>((res, rej) =>
            ftp.chmod(temp, existing.mode & 0o7777, (err) => (err ? rej(err) : res())),
          );
        }
        if (overwrite)
          await new Promise<void>((res, rej) =>
            ftp.ext_openssh_rename(temp, path, (err) => (err ? rej(err) : res())),
          );
        else await new Promise<void>((res, rej) => ftp.rename(temp, path, (err) => (err ? rej(err) : res())));
        return { bytes };
      } finally {
        await new Promise<void>((resolve) => ftp.unlink(temp, () => resolve()));
      }
    });
  }
  async download(
    id: string,
    path: string,
    target: Writable,
    headers: (size: number) => void,
    signal?: AbortSignal,
  ) {
    return this.machines.sftp(
      id,
      async (ftp) => {
        const { size } = await this.downloadInfo(ftp, path);
        signal?.throwIfAborted();
        headers(size);
        await pipeline(ftp.createReadStream(path), target, { signal });
      },
      signal,
    );
  }
  async operation(
    id: string,
    action: 'mkdir' | 'rename' | 'delete',
    path: string,
    destination?: string,
    recursive = false,
  ) {
    path = mutablePath(path);
    return this.machines.sftp(id, async (ftp) => {
      if (action === 'mkdir')
        await new Promise<void>((res, rej) => ftp.mkdir(path, (err) => (err ? rej(err) : res())));
      else if (action === 'rename') {
        const to = mutablePath(destination || '');
        if (await ftpStat(ftp, to)) throw new AppError('目标已存在', 409);
        await new Promise<void>((res, rej) => ftp.rename(path, to, (err) => (err ? rej(err) : res())));
      } else {
        let count = 0;
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
