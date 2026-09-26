import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError, DATA, checkedId, guestPath } from './model.ts';
import { readStore, regularDirectory, writeStore } from './local-store.ts';
import type { Files } from './files.ts';

export const UPLOAD_CHUNK_BYTES = 1024 ** 2;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z
  .object({
    path: z.string().refine((value) => {
      try {
        return guestPath(value) !== '/';
      } catch {
        return false;
      }
    }),
    size: z
      .number()
      .int()
      .min(0)
      .max(2 * 1024 ** 3),
    chunks: z.array(digest).max(2048),
    overwrite: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) => value.chunks.length === Math.ceil(value.size / UPLOAD_CHUNK_BYTES),
    '分块数量与文件大小不一致',
  );
type Session = z.infer<typeof requestSchema> & {
  id: string;
  vmId: string;
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
  completed?: { bytes: number; sha256: string };
  committing?: { bytes: number; sha256: string };
};

export class ResumableUploads {
  private active = new Set<string>();
  constructor(
    private files: Files,
    private root = join(DATA, 'uploads'),
  ) {}
  private folder(vmId: string, id: string) {
    return join(this.root, checkedId(vmId), z.uuid().parse(id));
  }
  private async exclusive<T>(key: string, action: () => Promise<T>) {
    if (this.active.has(key)) throw new AppError('此上传正在处理其他请求', 409);
    this.active.add(key);
    try {
      return await action();
    } finally {
      this.active.delete(key);
    }
  }
  private async session(vmId: string, id: string) {
    const folder = await regularDirectory(this.folder(vmId, id));
    const record = await readStore<Session | null>(join(folder, 'session.json'), () => null);
    if (!record || record.id !== id || record.vmId !== vmId) throw new AppError('上传会话不存在', 404);
    if (Date.parse(record.expiresAt) <= Date.now()) throw new AppError('上传会话已过期，请重新开始', 410);
    return record;
  }
  private async matchesTarget(
    session: Session,
    expected: { bytes: number; sha256: string },
    signal?: AbortSignal,
  ) {
    try {
      if ((await this.files.info(session.vmId, session.path)).size !== expected.bytes) return false;
      const digest = createHash('sha256');
      await this.files.download(
        session.vmId,
        session.path,
        new Writable({
          write(chunk, _encoding, done) {
            digest.update(chunk);
            done();
          },
        }),
        () => {},
        signal,
      );
      return digest.digest('hex') === expected.sha256;
    } catch {
      signal?.throwIfAborted();
      return false;
    }
  }
  async create(vmId: string, input: unknown) {
    const value = requestSchema.parse(input),
      folder = join(this.root, checkedId(vmId));
    return this.exclusive(vmId, async () => {
      await regularDirectory(folder);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const fingerprint = createHash('sha256').update(JSON.stringify(value)).digest('hex');
      let count = 0;
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (!entry.isDirectory() || !z.uuid().safeParse(entry.name).success) continue;
        const directory = this.folder(vmId, entry.name);
        const previous = await readStore<Session | null>(join(directory, 'session.json'), () => null);
        if (previous && Date.parse(previous.expiresAt) > Date.now()) {
          count++;
          if (
            previous.fingerprint === fingerprint &&
            (!previous.completed || (await this.matchesTarget(previous, previous.completed)))
          )
            return this.view(vmId, previous.id);
        } else if (![...this.active].some((key) => key.startsWith(vmId + ':' + entry.name))) {
          await rm(directory, { recursive: true, force: true });
        }
      }
      if (count >= 16) throw new AppError('最多保留 16 个上传会话，请删除不需要的会话', 409);
      const capacity = await statfs(folder);
      if (capacity.bavail * capacity.bsize < value.size + 64 * 1024 ** 2)
        throw new AppError('宿主磁盘空间不足', 507);
      const id = randomUUID(),
        session: Session = {
          ...value,
          id,
          vmId,
          fingerprint,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(),
        };
      await mkdir(this.folder(vmId, id), { mode: 0o700 });
      await writeStore(join(this.folder(vmId, id), 'session.json'), session);
      return { ...session, received: [] as number[], chunkBytes: UPLOAD_CHUNK_BYTES };
    });
  }
  async view(vmId: string, id: string) {
    const record = await this.session(vmId, id),
      received: number[] = [];
    for (const entry of await readdir(this.folder(vmId, id))) {
      const match = entry.match(/^(\d+)\.chunk$/);
      if (match && Number(match[1]) < record.chunks.length) received.push(Number(match[1]));
    }
    return { ...record, received: received.sort((a, b) => a - b), chunkBytes: UPLOAD_CHUNK_BYTES };
  }
  async chunk(vmId: string, id: string, index: number, input: Readable, signal: AbortSignal) {
    return this.exclusive(vmId + ':' + id, async () => {
      const session = await this.session(vmId, id);
      if (session.completed) throw new AppError('上传已完成', 409);
      if (!Number.isInteger(index) || index < 0 || index >= session.chunks.length)
        throw new AppError('分块索引无效');
      const size = Math.min(UPLOAD_CHUNK_BYTES, session.size - index * UPLOAD_CHUNK_BYTES);
      const temporary = join(this.folder(vmId, id), randomUUID() + '.tmp');
      const hash = createHash('sha256');
      let bytes = 0;
      try {
        await pipeline(
          input,
          new Transform({
            transform(chunk, _encoding, done) {
              bytes += chunk.length;
              if (bytes > size) return done(new AppError('分块长度超出声明', 413));
              hash.update(chunk);
              done(null, chunk);
            },
          }),
          createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
          { signal },
        );
        if (bytes !== size || hash.digest('hex') !== session.chunks[index])
          throw new AppError('分块长度或 SHA-256 校验失败', 409);
        signal.throwIfAborted();
        await rename(temporary, join(this.folder(vmId, id), index + '.chunk'));
        return { index, bytes };
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }
  async commit(vmId: string, id: string, signal: AbortSignal) {
    return this.exclusive(vmId + ':' + id, async () => {
      const session = await this.session(vmId, id);
      if (session.completed) {
        if (!(await this.matchesTarget(session, session.completed, signal)))
          throw new AppError('已上传的目标文件发生变化，请开始新上传', 409);
        return session.completed;
      }
      if (session.committing && (await this.matchesTarget(session, session.committing, signal))) {
        session.completed = session.committing;
        await writeStore(join(this.folder(vmId, id), 'session.json'), session);
        for (let index = 0; index < session.chunks.length; index++)
          await rm(join(this.folder(vmId, id), index + '.chunk'), { force: true });
        return session.completed;
      }
      const folder = this.folder(vmId, id),
        whole = createHash('sha256');
      for (let index = 0; index < session.chunks.length; index++) {
        const file = join(folder, index + '.chunk');
        if (
          (await stat(file).catch(() => null))?.size !==
          Math.min(UPLOAD_CHUNK_BYTES, session.size - index * UPLOAD_CHUNK_BYTES)
        )
          throw new AppError('上传分块不完整：' + index, 409);
        const chunk = await readFile(file);
        if (createHash('sha256').update(chunk).digest('hex') !== session.chunks[index])
          throw new AppError('已保存分块校验失败：' + index, 409);
        whole.update(chunk);
      }
      session.committing = { bytes: session.size, sha256: whole.digest('hex') };
      await writeStore(join(folder, 'session.json'), session);
      const source = Readable.from(
        (async function* () {
          for (let index = 0; index < session.chunks.length; index++) {
            signal.throwIfAborted();
            const chunk = await readFile(join(folder, index + '.chunk'));
            if (createHash('sha256').update(chunk).digest('hex') !== session.chunks[index])
              throw new AppError('已保存分块校验失败：' + index, 409);
            yield chunk;
          }
        })(),
      );
      const result = await this.files.upload(vmId, session.path, source, session.overwrite, signal);
      if (result.bytes !== session.size) throw new AppError('保存后的文件长度不一致', 409);
      session.completed = session.committing;
      await writeStore(join(folder, 'session.json'), session);
      for (let index = 0; index < session.chunks.length; index++)
        await rm(join(folder, index + '.chunk'), { force: true });
      return session.completed;
    });
  }
  async remove(vmId: string, id: string) {
    return this.exclusive(vmId + ':' + id, async () => {
      await regularDirectory(this.folder(vmId, id));
      await rm(this.folder(vmId, id), { recursive: true, force: true });
      return { removed: true };
    });
  }
}
