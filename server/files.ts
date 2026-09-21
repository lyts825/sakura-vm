import { randomUUID, createHash } from 'node:crypto';
import { posix } from 'node:path';
import { Readable, Writable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SFTPWrapper, Stats } from 'ssh2';
import { AppError, guestPath } from './model.ts';
import type { Machines } from './machines.ts';

export const MAX_TRANSFER = 2 * 1024 ** 3;
export const MAX_TEXT_BYTES = 1024 ** 2;
export const textVersion = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
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
export async function preserveFileMetadata(ftp: SFTPWrapper, path: string, attrs: Stats) {
  await new Promise<void>((resolve, reject) =>
    ftp.chown(path, attrs.uid, attrs.gid, (error) => (error ? reject(error) : resolve())),
  );
  // Ownership changes can clear setuid/setgid bits, so restore permissions last.
  await new Promise<void>((resolve, reject) =>
    ftp.chmod(path, attrs.mode & 0o7777, (error) => (error ? reject(error) : resolve())),
  );
}
export class Files {
  beforeReplace?: (id: string, path: string, ftp: SFTPWrapper, signal?: AbortSignal) => Promise<void>;
  trash?: (id: string, path: string, recursive: boolean) => Promise<unknown>;
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
  async upload(
    id: string,
    path: string,
    source: Readable,
    overwrite = false,
    signal?: AbortSignal,
    expectedVersion?: string,
  ) {
    signal?.throwIfAborted();
    path = mutablePath(path);
    const connection = new AbortController();
    const abortConnection = () => connection.abort(signal?.reason);
    signal?.addEventListener('abort', abortConnection, { once: true });
    try {
      return await this.machines.sftp(
        id,
        async (ftp, transportSignal) => {
          // Once connected, pipeline handles cancellation while SSH stays alive
          // long enough to close the upload handle and remove its temporary file.
          signal?.removeEventListener('abort', abortConnection);
          const transferSignal =
            transportSignal && signal
              ? AbortSignal.any([signal, transportSignal])
              : transportSignal || signal;
          transferSignal?.throwIfAborted();
          const existing = await ftpStat(ftp, path);
          transferSignal?.throwIfAborted();
          if (existing && (!overwrite || !existing.isFile()))
            throw new AppError('目标已存在；需要明确选择覆盖普通文件', 409);
          const checkVersion = async () => {
            if (expectedVersion === undefined) return;
            const current = await ftpStat(ftp, path);
            if (!current?.isFile() || current.size > MAX_TEXT_BYTES)
              throw new AppError('文件已被修改或删除，请比较最新版本', 409);
            const digest = createHash('sha256');
            await pipeline(
              ftp.createReadStream(path),
              new Writable({
                write(chunk, _encoding, cb) {
                  digest.update(chunk);
                  cb();
                },
              }),
              { signal: transferSignal },
            );
            if (digest.digest('hex') !== expectedVersion)
              throw new AppError('文件已被其他程序修改，请比较最新版本', 409);
          };
          await checkVersion();
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
              { signal: transferSignal },
            );
            if (existing) await preserveFileMetadata(ftp, temp, existing);
            if (existing) await this.beforeReplace?.(id, path, ftp, transferSignal);
            await checkVersion();
            transferSignal?.throwIfAborted();
            if (overwrite)
              await new Promise<void>((res, rej) =>
                ftp.ext_openssh_rename(temp, path, (err) => (err ? rej(err) : res())),
              );
            else
              await new Promise<void>((res, rej) =>
                ftp.rename(temp, path, (err) => (err ? rej(err) : res())),
              );
            return { bytes };
          } finally {
            if (!transportSignal?.aborted)
              await new Promise<void>((resolve) => ftp.unlink(temp, () => resolve()));
          }
        },
        connection.signal,
      );
    } finally {
      signal?.removeEventListener('abort', abortConnection);
    }
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
        // Bound reads to the stat result so appends cannot exceed Content-Length
        // or the transfer limit after the response headers have been selected.
        const source = size ? ftp.createReadStream(path, { start: 0, end: size - 1 }) : Readable.from([]);
        await pipeline(source, target, { signal });
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
    if (action === 'delete' && this.trash) return this.trash(id, path, recursive);
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
