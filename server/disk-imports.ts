import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { DATA, AppError } from './model.ts';
import { distroInfo } from './images.ts';
import { requireUefiSupport } from './firmware.ts';
import { regularDirectory, within } from './local-store.ts';
import { validateDiskHeader } from './bundles.ts';
import type { Machines } from './machines.ts';

const GiB = 1024 ** 3;
const MAX_UPLOAD = 8 * GiB;
const MAX_VIRTUAL = 128 * GiB;
export const diskImportSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  format: z.enum(['raw', 'vmdk', 'vhdx', 'ova']),
  distro: z.enum(['alpine', 'debian', 'ubuntu']),
  memoryMiB: z.number().int().min(256).max(8192),
  cpus: z.number().int().min(1).max(8),
  accelerator: z.enum(['auto', 'tcg', 'whpx']).default('auto'),
  firmware: z.enum(['bios', 'uefi']).default('bios'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type DiskImportInput = z.infer<typeof diskImportSchema>;

function tarText(bytes: Buffer) {
  return bytes.toString('utf8').split('\0')[0].trim();
}
function tarNumber(bytes: Buffer) {
  if (bytes[0] & 0x80) throw new AppError('暂不支持 TAR 二进制长度字段');
  const text = tarText(bytes).trim();
  if (!/^[0-7]+$/.test(text)) throw new AppError('OVA 的 TAR 长度字段损坏');
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UPLOAD)
    throw new AppError('OVA 条目超出 8 GiB 上限');
  return value;
}
function tarHeader(header: Buffer) {
  const claimed = tarNumber(header.subarray(148, 156));
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  if (sum !== claimed) throw new AppError('OVA TAR 标头校验失败');
  const name = tarText(header.subarray(0, 100));
  const prefix = tarText(header.subarray(345, 500));
  return { name: prefix ? `${prefix}/${name}` : name, size: tarNumber(header.subarray(124, 136)), type: header[156] };
}
function safeMember(name: string) {
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes(':') || name.split('/').some((part) => part === '..') || /[\x00-\x1f]/.test(name))
    throw new AppError('OVA 成员路径无效');
  return name;
}
function paxValues(data: Buffer) {
  const values: Record<string, string> = {};
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(32, at);
    if (space < 0) throw new AppError('OVA PAX 记录损坏');
    const length = Number(data.subarray(at, space).toString('ascii'));
    if (!Number.isSafeInteger(length) || length < 4 || at + length > data.length)
      throw new AppError('OVA PAX 记录损坏');
    if (data[at + length - 1] !== 10) throw new AppError('OVA PAX 记录损坏');
    const record = data.subarray(space + 1, at + length - 1).toString('utf8');
    const equal = record.indexOf('=');
    if (equal < 1) throw new AppError('OVA PAX 记录损坏');
    values[record.slice(0, equal)] = record.slice(equal + 1);
    at += length;
  }
  return values;
}
async function readAt(file: Awaited<ReturnType<typeof open>>, size: number, offset: number) {
  const data = Buffer.alloc(size);
  let received = 0;
  while (received < size) {
    const { bytesRead } = await file.read(data, received, size - received, offset + received);
    if (!bytesRead) throw new AppError('OVA 归档已截断');
    received += bytesRead;
  }
  return data;
}
/** Only a single regular VMDK payload is copied to a fixed temporary path. */
export async function extractOva(archive: string, target: string, signal?: AbortSignal) {
  const file = await open(archive, 'r');
  try {
    const size = (await file.stat()).size;
    let at = 0, entries = 0, pending: Record<string, string> | null = null;
    let disk: { name: string; offset: number; size: number } | undefined;
    let ovf: { name: string; references: string[] } | undefined;
    const seen = new Set<string>();
    while (at + 512 <= size) {
      signal?.throwIfAborted();
      if (++entries > 1024) throw new AppError('OVA 条目过多');
      const header = await readAt(file, 512, at);
      if (header.every((byte) => byte === 0)) break;
      const item = tarHeader(header);
      let name = item.name, length = item.size;
      if (pending && item.type !== 120) {
        if (pending.path) name = pending.path;
        if (pending.size) {
          if (!/^\d+$/.test(pending.size)) throw new AppError('OVA PAX 文件长度无效');
          length = Number(pending.size);
        }
        pending = null;
      }
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_UPLOAD)
        throw new AppError('OVA 条目超出 8 GiB 上限');
      const dataStart = at + 512;
      const next = dataStart + Math.ceil(length / 512) * 512;
      if (next > size) throw new AppError('OVA 归档已截断');
      if (item.type === 120) {
        if (length > 65536) throw new AppError('OVA PAX 标头过大');
        pending = paxValues(await readAt(file, length, dataStart));
      } else {
        name = safeMember(name);
        if (seen.has(name)) throw new AppError('OVA 成员名称重复');
        seen.add(name);
        if (/\.ovf$/i.test(name)) {
          if (ovf) throw new AppError('OVA 只能包含一个 OVF 描述文件');
          if (item.type !== 0 && item.type !== 48) throw new AppError('OVA 描述文件不是普通文件');
          if (length > 1024 * 1024) throw new AppError('OVA 描述文件过大');
          const contents = (await readAt(file, length, dataStart)).toString('utf8');
          if (!/<(?:[a-zA-Z0-9_-]+:)?Envelope\b/.test(contents)) throw new AppError('OVA OVF 描述文件无效');
          const references = [...contents.matchAll(/<(?:[\w.-]+:)?File\b[^>]*?\b(?:[\w.-]+:)?href\s*=\s*["']([^"']+)["']/gi)]
            .map((match) => match[1]);
          ovf = { name, references };
        }
        if (/\.vmdk$/i.test(name)) {
          if (item.type !== 0 && item.type !== 48) throw new AppError('OVA 磁盘不是普通文件');
          if (disk) throw new AppError('暂不支持多磁盘 OVA');
          disk = { name, offset: dataStart, size: length };
        }
      }
      at = next;
    }
    if (!ovf || !disk) throw new AppError('OVA 必须包含 OVF 描述文件和一个 VMDK 磁盘');
    if (!disk.size) throw new AppError('OVA 磁盘为空');
    if (ovf.references.length !== 1 ||
        posix.normalize(posix.join(posix.dirname(ovf.name), safeMember(ovf.references[0]))) !== disk.name)
      throw new AppError('OVA 磁盘与 OVF 文件引用不一致');
    await pipeline(
      createReadStream(archive, { start: disk.offset, end: disk.offset + disk.size - 1 }),
      createWriteStream(target, { flags: 'wx', mode: 0o600 }),
      { signal },
    );
    return { member: disk.name, bytes: disk.size };
  } finally {
    await file.close();
  }
}

export class DiskImports {
  constructor(private machines: Machines) {}
  async import(input: unknown, source: Readable, signal?: AbortSignal) {
    const request = diskImportSchema.parse(input);
    if (request.firmware === 'uefi') await requireUefiSupport();
    await regularDirectory(DATA);
    const transfers = join(DATA, 'transfers');
    await mkdir(transfers, { recursive: true });
    await regularDirectory(transfers);
    const dir = await mkdtemp(join(transfers, 'image-import-'));
    try {
      const upload = join(dir, `upload.${request.format}`);
      const hash = createHash('sha256');
      let bytes = 0;
      await pipeline(
        source,
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            const payload = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += payload.length;
            if (bytes > MAX_UPLOAD) return callback(new AppError('镜像文件超过 8 GiB', 413));
            hash.update(payload);
            callback(null, payload);
          },
        }),
        createWriteStream(upload, { flags: 'wx', mode: 0o600 }),
        { signal },
      );
      signal?.throwIfAborted();
      if (bytes < 512) throw new AppError('镜像文件过小');
      const checksum = hash.digest('hex');
      if (request.sha256 && request.sha256 !== checksum) throw new AppError('镜像 SHA-256 与预期不符');
      const sourceDisk = request.format === 'ova' ? join(dir, 'ova-disk.vmdk') : upload;
      const format = request.format === 'ova' ? 'vmdk' : request.format;
      const ova = request.format === 'ova' ? await extractOva(upload, sourceDisk, signal) : null;
      const header = await open(sourceDisk, 'r');
      try {
        const prefix = await readAt(header, Math.min(4, (await header.stat()).size), 0);
        if (format === 'vmdk' && prefix.toString() !== 'KDMV')
          throw new AppError('仅支持独立的单文件稀疏 VMDK');
        if (format === 'vhdx' && (await readAt(header, 8, 0)).toString() !== 'vhdxfile')
          throw new AppError('VHDX 文件标头无效');
      } finally {
        await header.close();
      }
      const info = JSON.parse(await this.machines.engine.run(
        'sakura-img', ['info', '-f', format, '--output=json', sourceDisk],
        { signal, timeoutMs: 60000 },
      ));
      const virtual = info['virtual-size'];
      if (info.format !== format || !Number.isSafeInteger(virtual) || virtual <= 0 || virtual > MAX_VIRTUAL)
        throw new AppError('镜像格式或虚拟容量无效：最大 128 GiB');
      if (info['backing-filename'] || info['full-backing-filename'] || info['format-specific']?.data?.['data-file'])
        throw new AppError('导入镜像不能依赖外部磁盘文件');
      if (format === 'vmdk') {
        const data = info['format-specific']?.data;
        const extents = data?.extents;
        if (!['monolithicSparse', 'streamOptimized'].includes(data?.['create-type']) ||
            (data?.['parent-cid'] !== undefined && data['parent-cid'] !== 0xffffffff) ||
            !Array.isArray(extents) || extents.length !== 1 ||
            typeof extents[0]?.filename !== 'string' ||
            resolve(dirname(sourceDisk), extents[0].filename).toLowerCase() !== resolve(sourceDisk).toLowerCase())
          throw new AppError('仅支持无父磁盘的独立单文件 VMDK');
      }
      const disk = join(dir, 'disk.qcow2');
      const diskGiB = Math.max(2, distroInfo(request.distro).minimumDisk, Math.ceil(virtual / GiB));
      await this.machines.engine.run('sakura-img', [
        'convert', '-f', format, '-O', 'qcow2', '-o', 'compat=1.1', sourceDisk, disk,
      ], { signal, timeoutMs: 3600000 });
      signal?.throwIfAborted();
      if (virtual < diskGiB * GiB)
        await this.machines.engine.run('sakura-img', ['resize', '-f', 'qcow2', disk, `${diskGiB}G`], { signal, timeoutMs: 60000 });
      if ((await stat(disk)).size > 32 * GiB) throw new AppError('转换后的 QCOW2 文件超过 32 GiB');
      const converted = JSON.parse(await this.machines.engine.run(
        'sakura-img', ['info', '-f', 'qcow2', '--output=json', disk], { signal, timeoutMs: 60000 },
      ));
      if (converted.format !== 'qcow2' || converted['virtual-size'] !== diskGiB * GiB ||
          converted['backing-filename'] || converted['format-specific']?.data?.['data-file'])
        throw new AppError('转换后的磁盘未通过独立性校验');
      const qcow = await open(disk, 'r');
      try { validateDiskHeader(await readAt(qcow, 104, 0)); } finally { await qcow.close(); }
      signal?.throwIfAborted();
      const vm = await this.machines.importDisk({
        name: request.name,
        distro: request.distro,
        memoryMiB: request.memoryMiB,
        cpus: request.cpus,
        accelerator: request.accelerator,
        firmware: request.firmware,
        diskGiB,
        forwards: [],
      }, disk, { signal, pendingResize: virtual < diskGiB * GiB });
      return { vm, source: { format: request.format, bytes, sha256: checksum, virtualBytes: virtual, ...(ova ? { member: ova.member } : {}) } };
    } finally {
      if (!within(transfers, dir) || !basename(dir).startsWith('image-import-'))
        throw new Error('镜像导入临时路径超出受控目录');
      await rm(dir, { recursive: true, force: true });
    }
  }
}
