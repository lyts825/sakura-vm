import { randomUUID, createHash } from 'node:crypto';
import { join, posix } from 'node:path';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { SFTPWrapper } from 'ssh2';
import type { Machines } from './machines.ts';
import { AppError, vmDir, guestPath } from './model.ts';
import { Files, ftpStat, mutablePath, MAX_TEXT_BYTES } from './files.ts';
import { readStore, writeStore } from './local-store.ts';

const entrySchema = z.object({
  id: z.uuid(),
  path: z.string().refine((p) => {
    try {
      return mutablePath(p) === p;
    } catch {
      return false;
    }
  }),
  kind: z.enum(['version', 'trash']),
  createdAt: z.string(),
  bytes: z.number().nonnegative(),
  version: z.string().optional(),
  ready: z.boolean().default(true),
});
export type HistoryEntry = z.infer<typeof entrySchema>;
export class FileHistory {
  constructor(
    private machines: Machines,
    private files: Files,
  ) {}
  private root(id: string) {
    this.machines.get(id);
    return join(vmDir(id), 'file-history');
  }
  async list(id: string, path?: string) {
    const values = z.array(entrySchema).parse(await readStore(join(this.root(id), 'index.json'), () => []));
    return values.filter((v) => !path || v.path === guestPath(path));
  }
  private async record(id: string, entry: HistoryEntry) {
    const values = (await this.list(id)).filter((v) => v.id !== entry.id);
    values.push(entry);
    const old = values.filter((v) => v.kind === 'version' && v.path === entry.path).slice(0, -20);
    const remaining = values.filter((v) => !old.includes(v));
    let total = remaining.filter((v) => v.kind === 'version').reduce((n, v) => n + v.bytes, 0);
    for (const item of [...remaining])
      if (
        item.kind === 'version' &&
        (total > 128 * 1024 ** 2 || remaining.filter((v) => v.kind === 'version').length > 500)
      ) {
        remaining.splice(remaining.indexOf(item), 1);
        old.push(item);
        total -= item.bytes;
      }
    await writeStore(join(this.root(id), 'index.json'), remaining);
    for (const item of old) await rm(join(this.root(id), `${item.id}.txt`), { force: true });
  }
  async capture(id: string, path: string, ftp: SFTPWrapper, signal?: AbortSignal) {
    const attrs = await ftpStat(ftp, path);
    if (!attrs?.isFile() || attrs.size > MAX_TEXT_BYTES) return;
    const chunks: Buffer[] = [];
    let bytes = 0;
    await pipeline(
      ftp.createReadStream(path),
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          if (bytes > MAX_TEXT_BYTES) return done(new AppError('历史版本超过文本上限'));
          chunks.push(chunk);
          done();
        },
      }),
      { signal },
    );
    const data = Buffer.concat(chunks);
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      return;
    }
    if (data.includes(0)) return;
    const version = createHash('sha256').update(data).digest('hex');
    await this.machines.locked(`history:${id}`, async () => {
      if ((await this.list(id, path)).findLast((v) => v.kind === 'version')?.version === version) return;
      const entry: HistoryEntry = {
        id: randomUUID(),
        path,
        kind: 'version',
        createdAt: new Date().toISOString(),
        bytes: data.length,
        version,
        ready: true,
      };
      await mkdir(this.root(id), { recursive: true });
      await writeFile(join(this.root(id), `${entry.id}.txt`), data, { mode: 0o600, flag: 'wx' });
      await this.record(id, entry);
    });
  }
  async trash(id: string, path: string, recursive = false) {
    path = mutablePath(path);
    if (path.split('/').some((p) => p.startsWith('.sakura-trash-')))
      throw new AppError('请在回收站管理已删除内容');
    return this.machines.locked(`history:${id}`, () =>
      this.machines.sftp(id, async (ftp) => {
        const attrs = await ftpStat(ftp, path);
        if (!attrs) throw new AppError('文件不存在', 404);
        if (attrs.isDirectory() && !recursive) throw new AppError('目录删除需要确认', 409);
        if ((await this.list(id)).filter((v) => v.kind === 'trash').length >= 200)
          throw new AppError('回收站已达 200 项，请先恢复或清理');
        const entry: HistoryEntry = {
          id: randomUUID(),
          path,
          kind: 'trash',
          createdAt: new Date().toISOString(),
          bytes: attrs.size,
          ready: false,
        };
        await this.record(id, entry);
        await new Promise<void>((resolve, reject) =>
          ftp.rename(path, this.trashPath(entry), (e) => (e ? reject(e) : resolve())),
        );
        await this.record(id, { ...entry, ready: true });
        return { ok: true, historyId: entry.id };
      }),
    );
  }
  private trashPath(entry: HistoryEntry) {
    return posix.join(posix.dirname(entry.path), `.sakura-trash-${entry.id}`);
  }
  private async find(id: string, key: string) {
    z.uuid().parse(key);
    const item = (await this.list(id)).find((v) => v.id === key);
    if (!item) throw new AppError('历史记录不存在', 404);
    return item;
  }
  async content(id: string, key: string) {
    const entry = await this.find(id, key);
    if (entry.kind !== 'version') throw new AppError('请选择文本历史版本');
    const content = await readFile(join(this.root(id), `${entry.id}.txt`), 'utf8');
    if (createHash('sha256').update(content).digest('hex') !== entry.version)
      throw new AppError('历史版本校验失败');
    return { entry, content };
  }
  async restore(id: string, key: string, expectedVersion?: string) {
    const entry = await this.find(id, key);
    if (entry.kind === 'version') {
      const { content } = await this.content(id, key);
      await this.files.upload(
        id,
        entry.path,
        Readable.from([content]),
        !!expectedVersion,
        undefined,
        expectedVersion,
      );
    } else
      await this.machines.locked(`history:${id}`, async () => {
        await this.machines.sftp(id, async (ftp) => {
          if (await ftpStat(ftp, entry.path)) throw new AppError('原路径已有文件，请先改名或移动', 409);
          await new Promise<void>((resolve, reject) =>
            ftp.rename(this.trashPath(entry), entry.path, (e) => (e ? reject(e) : resolve())),
          );
        });
        await writeStore(
          join(this.root(id), 'index.json'),
          (await this.list(id)).filter((v) => v.id !== key),
        );
      });
    return { ok: true, path: entry.path };
  }
  async purge(id: string, key: string) {
    return this.machines.locked(`history:${id}`, async () => {
      const entry = await this.find(id, key);
      if (entry.kind === 'trash')
        await new Files(this.machines).operation(id, 'delete', this.trashPath(entry), undefined, true);
      else await rm(join(this.root(id), `${entry.id}.txt`), { force: true });
      await writeStore(
        join(this.root(id), 'index.json'),
        (await this.list(id)).filter((v) => v.id !== key),
      );
      return { ok: true };
    });
  }
}
