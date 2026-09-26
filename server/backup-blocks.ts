import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Readable, type Writable } from 'node:stream';
import { pipeline, finished } from 'node:stream/promises';
import { z } from 'zod';
import { AppError, checkedId, DATA } from './model.ts';
import { regularDirectory, writeStore } from './local-store.ts';

const blockSize = 1024 * 1024;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z
  .object({
    version: z.literal(1),
    vmId: z.uuid(),
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    bytes: z
      .number()
      .int()
      .nonnegative()
      .max(129 * 1024 ** 3),
    sha256: sha,
    blockSize: z.literal(blockSize),
    chunks: z
      .array(z.object({ sha256: sha, bytes: z.number().int().min(1).max(blockSize) }).strict())
      .max(132096),
  })
  .strict();
export type BlockManifest = z.infer<typeof manifestSchema>;
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');

/** Immutable content blocks shared by all local, unencrypted backups. */
export class BackupBlocks {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private root = join(DATA, 'backup-blocks')) {}
  private serial<T>(work: () => Promise<T>, signal?: AbortSignal) {
    let started = false;
    const next = this.queue
      .catch(() => {})
      .then(() => {
        started = true;
        signal?.throwIfAborted();
        return work();
      });
    this.queue = next;
    if (!signal) return next;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        if (!started) reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      next.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  private manifestPath(vmId: string, id: string) {
    return join(this.root, 'manifests', checkedId(vmId), checkedId(id) + '.json');
  }
  private blockPath(hash: string) {
    return join(this.root, 'chunks', sha.parse(hash).slice(0, 2), hash);
  }
  private async manifest(vmId: string, id: string, expected?: string) {
    const file = this.manifestPath(vmId, id);
    await regularDirectory(dirname(file));
    const info = await lstat(file);
    if (!info.isFile() || info.size > 32 * 1024 ** 2) throw new AppError('备份块清单类型或大小无效');
    const value = manifestSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (
      value.vmId !== vmId ||
      value.id !== id ||
      (expected && value.sha256 !== expected) ||
      value.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0) !== value.bytes ||
      value.chunks.slice(0, -1).some((chunk) => chunk.bytes !== blockSize)
    )
      throw new AppError('备份块清单与备份记录不符', 409);
    return value;
  }
  read(vmId: string, id: string, expected?: string) {
    return this.serial(() => this.manifest(vmId, id, expected));
  }
  async pack(vmId: string, id: string, file: string, expected: string, signal: AbortSignal) {
    return this.serial(async () => {
      signal.throwIfAborted();
      const path = this.manifestPath(vmId, id);
      await regularDirectory(dirname(path));
      const exists = await lstat(path).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (exists) throw new AppError('备份块清单已存在，拒绝覆盖', 409);
      const info = await lstat(file);
      if (!info.isFile() || info.size > 129 * 1024 ** 3) throw new AppError('备份源类型或大小无效');
      const handle = await open(file, 'r'),
        whole = createHash('sha256');
      const chunks: BlockManifest['chunks'] = [],
        checked = new Set<string>(),
        folders = new Set<string>();
      let bytes = 0;
      try {
        while (bytes < info.size) {
          signal.throwIfAborted();
          const buffer = Buffer.alloc(Math.min(blockSize, info.size - bytes));
          let offset = 0;
          while (offset < buffer.length) {
            const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, bytes + offset);
            if (!bytesRead) throw new AppError('备份在分块时被截断');
            offset += bytesRead;
          }
          const hash = digest(buffer),
            block = this.blockPath(hash),
            folder = dirname(block);
          if (!folders.has(folder)) {
            await regularDirectory(folder);
            await mkdir(folder, { recursive: true });
            folders.add(folder);
          }
          if (!checked.has(hash)) {
            const existing = await lstat(block).catch((error) => {
              if (error.code !== 'ENOENT') throw error;
              return null;
            });
            if (existing) {
              if (
                !existing.isFile() ||
                existing.size !== buffer.length ||
                digest(await readFile(block)) !== hash
              )
                throw new AppError('已有备份块损坏，拒绝复用：' + hash, 409);
            } else {
              const temp = block + '.' + randomUUID() + '.part';
              try {
                await writeFile(temp, buffer, { flag: 'wx', mode: 0o600, flush: true });
                signal.throwIfAborted();
                await rename(temp, block);
              } finally {
                await rm(temp, { force: true });
              }
            }
            checked.add(hash);
          }
          chunks.push({ sha256: hash, bytes: buffer.length });
          whole.update(buffer);
          bytes += buffer.length;
        }
        if ((await handle.stat()).size !== info.size) throw new AppError('备份在分块时发生变化');
      } finally {
        await handle.close();
      }
      const checksum = whole.digest('hex');
      if (checksum !== sha.parse(expected)) throw new AppError('备份分块后的整体哈希不符', 409);
      signal.throwIfAborted();
      const value: BlockManifest = {
        version: 1,
        vmId,
        id,
        createdAt: new Date().toISOString(),
        bytes,
        sha256: checksum,
        blockSize,
        chunks,
      };
      await writeStore(path, value);
      return value;
    }, signal);
  }
  private async *content(value: BlockManifest, signal: AbortSignal) {
    const whole = createHash('sha256'),
      directories = new Set<string>();
    for (const chunk of value.chunks) {
      signal.throwIfAborted();
      const file = this.blockPath(chunk.sha256),
        directory = dirname(file);
      if (!directories.has(directory)) {
        await regularDirectory(directory);
        directories.add(directory);
      }
      const info = await lstat(file);
      if (!info.isFile() || info.size !== chunk.bytes)
        throw new AppError('备份块缺失或大小错误：' + chunk.sha256, 409);
      const bytes = await readFile(file);
      if (digest(bytes) !== chunk.sha256) throw new AppError('备份块校验失败：' + chunk.sha256, 409);
      whole.update(bytes);
      yield bytes;
    }
    if (whole.digest('hex') !== value.sha256) throw new AppError('重组备份的整体校验失败', 409);
  }
  writeTo(vmId: string, id: string, expected: string, output: Writable, signal: AbortSignal) {
    // Holding the store lock also prevents deletion/GC while a download is in flight.
    return this.serial(async () => {
      signal.throwIfAborted();
      const value = await this.manifest(vmId, id, expected);
      await pipeline(Readable.from(this.content(value, signal)), output, { signal });
    }, signal);
  }
  async withFile<T>(
    vmId: string,
    id: string,
    expected: string,
    signal: AbortSignal,
    work: (file: string) => Promise<T>,
  ) {
    const directory = join(this.root, 'materialized');
    await regularDirectory(directory);
    await mkdir(directory, { recursive: true });
    const file = join(directory, randomUUID() + '.sakura');
    const output = createWriteStream(file, { flags: 'wx', mode: 0o600 });
    const closed = finished(output).catch(() => {});
    try {
      await this.writeTo(vmId, id, expected, output, signal);
      signal.throwIfAborted();
      return await work(file);
    } finally {
      output.destroy();
      await closed;
      await rm(file, { force: true });
    }
  }
  remove(vmId: string, id: string) {
    return this.serial(async () => {
      const file = this.manifestPath(vmId, id);
      await regularDirectory(dirname(file));
      await rm(file, { force: true });
    });
  }
  inspect(collect = false, signal?: AbortSignal) {
    return this.serial(async () => {
      await regularDirectory(this.root);
      const references = new Map<string, number>();
      let logicalBytes = 0,
        backups = 0;
      const manifests = join(this.root, 'manifests');
      await regularDirectory(manifests);
      for (const machine of await readdir(manifests, { withFileTypes: true }).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return [];
      })) {
        if (!/^[a-f0-9-]{36}$/.test(machine.name)) continue;
        if (!machine.isDirectory()) throw new AppError('备份清单目录不能包含链接');
        for (const entry of await readdir(join(manifests, machine.name), { withFileTypes: true })) {
          signal?.throwIfAborted();
          if (!/^[a-f0-9-]{36}\.json$/.test(entry.name)) continue;
          const manifest = await this.manifest(machine.name, entry.name.slice(0, -5));
          logicalBytes += manifest.bytes;
          backups++;
          for (const chunk of manifest.chunks) {
            if (references.has(chunk.sha256) && references.get(chunk.sha256) !== chunk.bytes)
              throw new AppError('同一备份块包含冲突大小');
            references.set(chunk.sha256, chunk.bytes);
          }
        }
      }
      const chunks = join(this.root, 'chunks');
      await regularDirectory(chunks);
      let physicalBytes = 0,
        reclaimedBytes = 0,
        orphanBytes = 0,
        chunkCount = 0;
      const found = new Set<string>();
      const orphans: string[] = [];
      for (const folder of await readdir(chunks, { withFileTypes: true }).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return [];
      })) {
        if (!/^[a-f0-9]{2}$/.test(folder.name)) continue;
        if (!folder.isDirectory()) throw new AppError('备份块目录不能包含链接');
        for (const block of await readdir(join(chunks, folder.name), { withFileTypes: true })) {
          signal?.throwIfAborted();
          if (!/^[a-f0-9]{64}$/.test(block.name)) continue;
          if (!block.isFile() || !block.name.startsWith(folder.name))
            throw new AppError('备份块路径类型无效');
          const file = this.blockPath(block.name),
            info = await lstat(file);
          physicalBytes += info.size;
          chunkCount++;
          if (!references.has(block.name)) {
            orphanBytes += info.size;
            orphans.push(file);
          } else {
            if (references.get(block.name) !== info.size) throw new AppError('已引用备份块大小不符');
            found.add(block.name);
          }
        }
      }
      if (found.size !== references.size) throw new AppError('备份存在缺失的内容块，拒绝清理', 409);
      // Validate every manifest/reference before removing any unreferenced block.
      if (collect)
        for (const file of orphans) {
          signal?.throwIfAborted();
          await rm(file);
        }
      if (collect) {
        reclaimedBytes = orphanBytes;
        physicalBytes -= orphanBytes;
        chunkCount -= orphans.length;
        orphanBytes = 0;
      }
      const referencedBytes = [...references.values()].reduce((sum, bytes) => sum + bytes, 0);
      return {
        backups,
        logicalBytes,
        physicalBytes,
        referencedBytes,
        savedBytes: Math.max(0, logicalBytes - referencedBytes),
        orphanBytes,
        reclaimedBytes,
        chunkCount,
        blockSize,
      };
    }, signal);
  }
  async close() {
    await this.queue.catch(() => {});
  }
}

let store: BackupBlocks | undefined;
export function backupBlocks() {
  return (store ||= new BackupBlocks());
}
