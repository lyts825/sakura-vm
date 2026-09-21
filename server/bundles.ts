import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError, DATA, createSchema, vmDir } from './model.ts';
import type { Machines } from './machines.ts';
import { projectSchema } from './workspaces.ts';
import ssh2 from 'ssh2';

const MAGIC = Buffer.from('SAKURA01');
const MAX_BUNDLE = 32 * 1024 ** 3;
const manifestSchema = z
  .object({
    version: z.literal(1),
    config: createSchema,
    project: projectSchema.optional(),
    key: z.string().max(16384),
    seed: z.string().max(262144),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export function validateDiskHeader(header: Buffer) {
  if (
    header.length < 104 ||
    header.readUInt32BE(0) !== 0x514649fb ||
    ![2, 3].includes(header.readUInt32BE(4))
  )
    throw new AppError('需要 QCOW2 磁盘');
  if (header.readBigUInt64BE(8) !== 0n || header.readUInt32BE(16) !== 0)
    throw new AppError('导入磁盘不能依赖外部基础镜像');
  if (header.readUInt32BE(32) !== 0) throw new AppError('不支持加密磁盘');
  if (header.readUInt32BE(4) === 3 && (header.readBigUInt64BE(72) & 4n) !== 0n)
    throw new AppError('不支持外部数据文件');
  if (header.readBigUInt64BE(24) > 128n * 1024n ** 3n) throw new AppError('虚拟磁盘不能超过 128 GiB');
}
export class Bundles {
  constructor(private machines: Machines) {}
  private async project(id: string) {
    try {
      return projectSchema.parse(JSON.parse(await readFile(join(vmDir(id), 'project.json'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    }
  }
  private async temp() {
    await mkdir(join(DATA, 'transfers'), { recursive: true });
    return mkdtemp(join(DATA, 'transfers', 'bundle-'));
  }
  async export(id: string, target: Writable, headers: () => void, signal?: AbortSignal) {
    return this.machines.locked(id, async () => {
      this.machines.requireStopped(id);
      const dir = await this.temp();
      try {
        const disk = join(dir, 'disk.qcow2');
        await this.machines.engine.run(
          'sakura-img',
          ['convert', '-f', 'qcow2', '-O', 'qcow2', join(vmDir(id), 'disk.qcow2'), disk],
          { timeoutMs: 1800000, signal },
        );
        signal?.throwIfAborted();
        const hash = createHash('sha256');
        if ((await stat(disk)).size + 300012 > MAX_BUNDLE) throw new AppError('当前导出包上限为 32 GiB');
        for await (const chunk of createReadStream(disk)) {
          signal?.throwIfAborted();
          hash.update(chunk);
        }
        const { name, memoryMiB, cpus, diskGiB, accelerator, forwards, distro, template } =
          this.machines.get(id);
        const identity = await this.machines.snapshotIdentity(id);
        const manifest = Buffer.from(
          JSON.stringify({
            version: 1,
            config: { name, memoryMiB, cpus, diskGiB, accelerator, forwards, distro, template },
            project: await this.project(id),
            key: identity.key,
            seed: identity.seed.toString('base64'),
            sha256: hash.digest('hex'),
          }),
        );
        const length = Buffer.alloc(4);
        length.writeUInt32BE(manifest.length);
        signal?.throwIfAborted();
        headers();
        async function* contents() {
          yield MAGIC;
          yield length;
          yield manifest;
          yield* createReadStream(disk);
        }
        await pipeline(Readable.from(contents()), target, { signal });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
  async import(name: string, source: Readable, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const dir = await this.temp();
    const disk = join(dir, 'disk.qcow2');
    try {
      let prefix = Buffer.alloc(0),
        manifest: z.infer<typeof manifestSchema> | undefined,
        total = 0;
      const hash = createHash('sha256');
      await pipeline(
        source,
        new Transform({
          transform(chunk: Buffer, _enc, cb) {
            total += chunk.length;
            if (total > MAX_BUNDLE) return cb(new AppError('导入包超过 32 GiB', 413));
            if (!manifest) {
              prefix = Buffer.concat([prefix, chunk]);
              if (prefix.length < 12) return cb();
              if (!prefix.subarray(0, 8).equals(MAGIC)) return cb(new AppError('不是 Sakura 导出文件'));
              const length = prefix.readUInt32BE(8);
              if (length > 300000 || length < 2) return cb(new AppError('无效的导入清单'));
              if (prefix.length < 12 + length) return cb();
              try {
                manifest = manifestSchema.parse(
                  JSON.parse(prefix.subarray(12, 12 + length).toString('utf8')),
                );
              } catch {
                return cb(new AppError('导入清单损坏'));
              }
              chunk = prefix.subarray(12 + length);
              prefix = Buffer.alloc(0);
            }
            hash.update(chunk);
            cb(null, chunk);
          },
        }),
        createWriteStream(disk, { flags: 'wx' }),
        { signal },
      );
      signal?.throwIfAborted();
      if (!manifest || hash.digest('hex') !== manifest.sha256)
        throw new AppError('导入包不完整或磁盘校验失败');
      const handle = await open(disk, 'r');
      try {
        const b = Buffer.alloc(104);
        await handle.read(b, 0, b.length, 0);
        validateDiskHeader(b);
      } finally {
        await handle.close();
      }
      const info = JSON.parse(
        await this.machines.engine.run('sakura-img', ['info', '-f', 'qcow2', '--output=json', disk], {
          signal,
        }),
      );
      if (info['backing-filename'] || info['format-specific']?.data?.['data-file'])
        throw new AppError('导入磁盘含外部依赖');
      const key = manifest.key;
      const parsedKey = ssh2.utils.parseKey(key);
      const identity = Array.isArray(parsedKey) ? parsedKey[0] : parsedKey;
      if (!identity || identity instanceof Error || !identity.getPrivatePEM())
        throw new AppError('导入包缺少有效实例身份私钥');
      const seed = Buffer.from(manifest.seed, 'base64');
      if (seed.length < 34816 || seed.toString('ascii', 32769, 32774) !== 'CD001')
        throw new AppError('初始化镜像已损坏');
      signal?.throwIfAborted();
      return await this.machines.adopt(
        { ...manifest.config, name, forwards: [] },
        disk,
        key,
        seed,
        manifest.project,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  async clone(id: string, name: string, snapshot?: string, signal?: AbortSignal) {
    return this.machines.locked(id, async () => {
      signal?.throwIfAborted();
      this.machines.requireStopped(id);
      const vm = this.machines.get(id);
      if (snapshot && !vm.snapshots.some((s) => s.id === snapshot)) throw new AppError('快照不存在', 404);
      const dir = await this.temp();
      try {
        const disk = join(dir, 'disk.qcow2');
        await this.machines.engine.run(
          'sakura-img',
          [
            'convert',
            '-f',
            'qcow2',
            '-O',
            'qcow2',
            ...(snapshot ? ['-l', snapshot] : []),
            join(vmDir(id), 'disk.qcow2'),
            disk,
          ],
          { timeoutMs: 1800000, signal },
        );
        const identity = await this.machines.snapshotIdentity(id, snapshot);
        const { memoryMiB, cpus, diskGiB, accelerator, distro, template } = vm;
        const project = await this.project(id);
        signal?.throwIfAborted();
        return await this.machines.adopt(
          { name, memoryMiB, cpus, diskGiB, accelerator, distro, template, forwards: [] },
          disk,
          identity.key,
          identity.seed,
          project,
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
}
