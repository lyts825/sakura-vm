import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute, sep, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError } from './model.ts';
import { writeStore } from './local-store.ts';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const path = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) =>
    value.split('/').every((part) => part && part !== '.' && part !== '..' && !/[\\\x00-\x1f]/.test(part)),
  );
const meta = z
  .object({
    sha,
    mode: z.number().int().nonnegative(),
    uid: z.number().int().nonnegative().optional(),
    gid: z.number().int().nonnegative().optional(),
  })
  .strict();
const entrySchema = z
  .object({ side: z.enum(['host', 'guest']), path, before: meta.nullable(), after: sha.nullable() })
  .strict();
const checkpointSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    host: z.string(),
    guest: z.string(),
    status: z.enum(['pending', 'done', 'failed', 'rolled-back']),
    bytes: z.number().nonnegative(),
    entries: z.array(entrySchema).max(40000),
    error: z.string().optional(),
    state: sha.nullable(),
    base: sha.nullable(),
    afterState: sha.nullable().optional(),
    afterBase: sha.nullable().optional(),
  })
  .strict();
export type SyncCheckpoint = z.infer<typeof checkpointSchema>;
export type SyncHistoryView = Pick<SyncCheckpoint, 'id' | 'createdAt' | 'status' | 'bytes' | 'error'> & {
  changes: number;
};
export type SyncSide = 'host' | 'guest';
export type SyncFileVersion = z.infer<typeof meta>;
export type SyncRestoreEntry = z.infer<typeof entrySchema>;
type Source = { stream: Readable; mode: number; uid?: number; gid?: number };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function optionalFile(file: string) {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Local recovery points contain verified original bytes and a write-ahead list of
 * intended hashes. Recovery accepts only an original or an intended version. */
export class SyncHistory {
  constructor(
    private root: string,
    private stateFile: string,
    private baseFile: string,
  ) {}
  private directory(id: string) {
    return join(this.root, z.uuid().parse(id));
  }
  async read(id: string) {
    const file = join(this.directory(id), 'checkpoint.json');
    if ((await lstat(file)).size > 32 * 1024 ** 2) throw new AppError('同步回滚记录超过限制');
    const point = checkpointSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (point.id !== id) throw new AppError('同步回滚标识不匹配');
    return point;
  }
  async list(): Promise<SyncHistoryView[]> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const points: SyncHistoryView[] = [];
    for (const name of names) {
      if (!z.uuid().safeParse(name).success) continue;
      try {
        const point = await this.read(name);
        points.push({
          id: point.id,
          createdAt: point.createdAt,
          status: point.status,
          bytes: point.bytes,
          changes: point.entries.length,
          error: point.error,
        });
      } catch (error) {
        // An interrupted initial capture has no published checkpoint and changed no files.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return points.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  private async remove(id: string) {
    const directory = resolve(this.directory(id)),
      root = resolve(this.root),
      rel = relative(root, directory);
    if (
      !rel ||
      isAbsolute(rel) ||
      rel.startsWith('..' + sep) ||
      rel === '..' ||
      dirnameIsSymlink(await lstat(directory))
    )
      throw new AppError('同步回滚目录不安全');
    await rm(directory, { recursive: true, force: true });
  }
  async begin(
    roots: { host: string; guest: string },
    files: { host: Map<string, string>; guest: Map<string, string> },
    source: (side: SyncSide, name: string) => Promise<Source>,
    signal: AbortSignal,
  ) {
    const prior = await this.list();
    // Retain unresolved recovery points. Completed points are capped at ten.
    for (const point of prior
      .filter((point) => point.status === 'done' || point.status === 'rolled-back')
      .slice(9))
      await this.remove(point.id);
    if (prior.filter((point) => point.status === 'failed' || point.status === 'pending').length >= 10)
      throw new AppError('存在 10 个未解决的同步回滚点，请先恢复最近的变更');
    const point: SyncCheckpoint = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      host: roots.host,
      guest: roots.guest,
      status: 'pending',
      bytes: 0,
      entries: [],
      state: null,
      base: null,
    };
    const directory = this.directory(point.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const originals = new Map<string, SyncFileVersion>();
    const blobs = new Set<string>();
    try {
      for (const kind of ['state', 'base'] as const) {
        const bytes = await optionalFile(kind === 'state' ? this.stateFile : this.baseFile);
        if (bytes) {
          if (bytes.length > 32 * 1024 ** 2) throw new AppError('同步基线超过回滚限制');
          point[kind] = digest(bytes);
          await writeFile(join(directory, kind + '.json'), bytes, { flag: 'wx', mode: 0o600 });
        }
      }
      for (const side of ['host', 'guest'] as const)
        for (const [name, expected] of files[side]) {
          signal.throwIfAborted();
          path.parse(name);
          const input = await source(side, name);
          originals.set(side + ':' + name, {
            sha: expected,
            mode: input.mode,
            uid: input.uid,
            gid: input.gid,
          });
          const hash = createHash('sha256');
          let bytes = 0;
          const check = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              bytes += chunk.length;
              if (bytes > 256 * 1024 ** 2 || (!blobs.has(expected) && point.bytes + bytes > 512 * 1024 ** 2))
                return callback(new AppError('回滚点最多保存 512 MiB 文件，请缩小同步范围或关闭回滚点'));
              hash.update(chunk);
              callback(null, chunk);
            },
          });
          if (!blobs.has(expected)) {
            await pipeline(
              input.stream,
              check,
              createWriteStream(join(directory, expected), { flags: 'wx', mode: 0o600 }),
              { signal },
            );
            if (hash.digest('hex') !== expected)
              throw new AppError('保存回滚点期间文件已变化，请重新预览', 409);
            point.bytes += bytes;
            blobs.add(expected);
          } else {
            // Even a duplicate must be read: the scan may have become stale.
            const sink = new Transform({
              transform(_chunk, _encoding, callback) {
                callback();
              },
            });
            sink.resume();
            await pipeline(input.stream, check, sink, { signal });
            if (hash.digest('hex') !== expected)
              throw new AppError('保存回滚点期间文件已变化，请重新预览', 409);
          }
        }
      await this.save(point);
    } catch (error) {
      await this.remove(point.id);
      throw error;
    }
    return {
      prepare: async (entries: { side: SyncSide; path: string; after: string | null }[]) => {
        for (const entry of entries) {
          const existing = point.entries.find((item) => item.side === entry.side && item.path === entry.path);
          if (existing) existing.after = entry.after;
          else point.entries.push({ ...entry, before: originals.get(entry.side + ':' + entry.path) || null });
        }
        await this.save(point);
      },
      finish: async (error?: unknown) => {
        point.status = error ? 'failed' : 'done';
        if (error) point.error = String((error as Error)?.message || error).slice(0, 1000);
        const state = await optionalFile(this.stateFile),
          base = await optionalFile(this.baseFile);
        point.afterState = state ? digest(state) : null;
        point.afterBase = base ? digest(base) : null;
        await this.save(point);
      },
    };
  }
  private save(point: SyncCheckpoint) {
    return writeStore(join(this.directory(point.id), 'checkpoint.json'), checkpointSchema.parse(point));
  }
  async restore(
    id: string,
    roots: { host: string; guest: string },
    current: (side: SyncSide, path: string) => Promise<string | null>,
    apply: (entry: SyncRestoreEntry, blob: string | null, expected: string | null) => Promise<void>,
    signal: AbortSignal,
  ) {
    const latest = (await this.list()).find((point) => point.status !== 'rolled-back');
    if (latest?.id !== id) throw new AppError('请从最近一次同步开始回滚', 409);
    const point = await this.read(id),
      directory = this.directory(id);
    if (point.host !== roots.host || point.guest !== roots.guest)
      throw new AppError('同步目录已改变，无法应用此回滚点', 409);
    const baseline: Record<string, Buffer | null> = {};
    for (const kind of ['state', 'base'] as const) {
      const file = kind === 'state' ? this.stateFile : this.baseFile;
      const actual = await optionalFile(file),
        actualHash = actual ? digest(actual) : null;
      const after = kind === 'state' ? point.afterState : point.afterBase;
      if (actualHash !== point[kind] && actualHash !== after)
        throw new AppError('同步基线已改变，请先回滚后续操作', 409);
      baseline[kind] = point[kind] ? await readFile(join(directory, kind + '.json')) : null;
      if (baseline[kind] && digest(baseline[kind]!) !== point[kind]) throw new AppError('回滚基线校验失败');
    }
    const verified = new Set<string>(),
      expected = new Map<string, string | null>();
    for (const entry of point.entries) {
      signal.throwIfAborted();
      const actual = await current(entry.side, entry.path);
      if (actual !== (entry.before?.sha || null) && actual !== entry.after)
        throw new AppError('同步后文件已被修改，保留现有内容：' + entry.path, 409);
      expected.set(entry.side + ':' + entry.path, actual);
      if (entry.before && !verified.has(entry.before.sha)) {
        const file = join(directory, entry.before.sha),
          info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024 ** 2)
          throw new AppError('回滚文件不安全');
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
        if (hash.digest('hex') !== entry.before.sha) throw new AppError('回滚文件校验失败：' + entry.path);
        verified.add(entry.before.sha);
      }
    }
    // Complete validation precedes the first restoration; each write checks again.
    for (const entry of [...point.entries].reverse()) {
      signal.throwIfAborted();
      const value = expected.get(entry.side + ':' + entry.path)!;
      if (value !== (entry.before?.sha || null))
        await apply(entry, entry.before ? join(directory, entry.before.sha) : null, value);
    }
    for (const kind of ['state', 'base'] as const) {
      const file = kind === 'state' ? this.stateFile : this.baseFile;
      if (baseline[kind]) await writeStore(file, JSON.parse(baseline[kind]!.toString('utf8')));
      else await rm(file, { force: true });
    }
    point.status = 'rolled-back';
    delete point.error;
    await this.save(point);
    return { restored: point.entries.length, id: point.id };
  }
}
function dirnameIsSymlink(info: Awaited<ReturnType<typeof lstat>>) {
  return info.isSymbolicLink() || !info.isDirectory();
}
