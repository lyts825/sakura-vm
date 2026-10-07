/**
 * 模块职责：解析并导入外部磁盘及 OVA；限制 TAR 成员、路径和磁盘依赖，防止导入越界。
 * Module purpose: Parses external disks and OVA archives, bounding TAR members, paths and disk dependencies before import.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { DATA } from './paths.ts';
import { AppError } from '../shared/errors.ts';
import { distroInfo } from './images.ts';
import { requireUefiSupport } from './firmware.ts';
import { regularDirectory, within } from './local-store.ts';
import { validateDiskHeader } from './bundles.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { storageRuntime, storageGrowth, type StorageLease } from './storage-runtime.ts';

const GiB = 1024 ** 3;
const MAX_UPLOAD = 8 * GiB;
const MAX_VIRTUAL = 128 * GiB;
export const diskImportSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    format: z.enum(['raw', 'vmdk', 'vhdx', 'ova']),
    distro: z.enum(['alpine', 'debian', 'ubuntu']),
    architecture: z.enum(['x86_64', 'aarch64']).default('x86_64'),
    memoryMiB: z.number().int().min(256).max(8192),
    cpus: z.number().int().min(1).max(8),
    accelerator: z.enum(['auto', 'tcg', 'whpx']).default('auto'),
    firmware: z.enum(['bios', 'uefi']).default('bios'),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.architecture === 'aarch64' &&
      (value.distro !== 'debian' || value.firmware !== 'uefi' || value.accelerator === 'whpx')
    )
      ctx.addIssue({ code: 'custom', message: 'ARM64 导入需要 Debian、UEFI 和 TCG 兼容模式' });
  });
export type DiskImportInput = z.infer<typeof diskImportSchema>;

/**
 * 入口 / Entry: tarText.
 * 功能：在解析并导入外部磁盘及 OVA中，执行此领域的具体处理步骤并返回其结果；本入口产生 `bytes.toString('utf8').split('\0')[0].trim()` 供上层消费（`disk-imports.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `disk-imports.ts`; this entry produces `bytes.toString('utf8').split('\0')[0].trim()` for its caller. Module context: Parses external disks and OVA archives, bounding TAR members, paths and disk dependencies before import.
 * 处理：通过 `bytes.toString().split()[...].trim`, `bytes.toString().split`, `bytes.toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `bytes.toString().split()[...].trim`, `bytes.toString().split`, `bytes.toString`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: bytes: Buffer
 * 输出 / Returns: `bytes.toString('utf8').split('\0')[0].trim()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function tarText(bytes: Buffer) {
  return bytes.toString('utf8').split('\0')[0].trim();
}
/**
 * 入口 / Entry: tarNumber.
 * 功能：在解析并导入外部磁盘及 OVA中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value` 供上层消费（`disk-imports.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `disk-imports.ts`; this entry produces `value` for its caller. Module context: Parses external disks and OVA archives, bounding TAR members, paths and disk dependencies before import.
 * 处理：通过 `tarText().trim`, `tarText`, `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `tarText().trim`, `tarText`, `inline.test`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: bytes: Buffer
 * 输出 / Returns: `value`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `bytes[0] & 0x80`; `!/^[0-7]+$/.test(text)`; `!Number.isSafeInteger(value) || value < 0 || value > MAX_UPLOAD`; 异常 / errors `new AppError('暂不支持 TAR 二进制长度字段')`; `new AppError('OVA 的 TAR 长度字段损坏')`.
 */
function tarNumber(bytes: Buffer) {
  if (bytes[0] & 0x80) throw new AppError('暂不支持 TAR 二进制长度字段');
  const text = tarText(bytes).trim();
  if (!/^[0-7]+$/.test(text)) throw new AppError('OVA 的 TAR 长度字段损坏');
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UPLOAD)
    throw new AppError('OVA 条目超出 8 GiB 上限');
  return value;
}
/**
 * 入口 / Entry: tarHeader.
 * 功能：在解析并导入外部磁盘及 OVA中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ name: prefix ? `${prefix}/${name}` : name, size: tarNumber(header.subarray(124, 136)), type: header[156], }` 供上层消费（`disk-imports.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `disk-imports.ts`; this entry produces `{ name: prefix ? `${prefix}/${name}` : name, size: tarNumber(header.subarray(124, 136)), type: header[156], }` for its caller. Module context: Parses external disks and OVA archives, bounding TAR members, paths and disk dependencies before import.
 * 处理：通过 `tarNumber`, `header.subarray`, `tarText` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `tarNumber`, `header.subarray`, `tarText`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: header: Buffer
 * 输出 / Returns: `{ name: prefix ? `${prefix}/${name}` : name, size: tarNumber(header.subarray(124, 136)), type: header[156], }`.
 * 副作用 / Effects: 更新 / updates `sum`.
 * 拒绝 / Refusals: 条件 / conditions `sum !== claimed`; 异常 / errors `new AppError('OVA TAR 标头校验失败')`.
 */
function tarHeader(header: Buffer) {
  const claimed = tarNumber(header.subarray(148, 156));
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  if (sum !== claimed) throw new AppError('OVA TAR 标头校验失败');
  const name = tarText(header.subarray(0, 100));
  const prefix = tarText(header.subarray(345, 500));
  return {
    name: prefix ? `${prefix}/${name}` : name,
    size: tarNumber(header.subarray(124, 136)),
    type: header[156],
  };
}
/**
 * 入口 / Entry: safeMember.
 * 功能：在解析并导入外部磁盘及 OVA中，执行此领域的具体处理步骤并返回其结果；本入口产生 `name` 供上层消费（`disk-imports.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `disk-imports.ts`; this entry produces `name` for its caller. Module context: Parses external disks and OVA archives, bounding TAR members, paths and disk dependencies before import.
 * 处理：通过 `name.startsWith`, `name.includes`, `name.split().some`, `name.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `name.startsWith`, `name.includes`, `name.split().some`, `name.split`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: name: string
 * 输出 / Returns: `name`.
 * 副作用 / Effects: `name.startsWith`.
 * 拒绝 / Refusals: 条件 / conditions `!name || name.startsWith('/') || name.includes('\\') || name.includes(':') || name.split('/').some((part) => part === '..') |…`; 异常 / errors `new AppError('OVA 成员路径无效')`.
 */
function safeMember(name: string) {
  if (
    !name ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes(':') ||
    name.split('/').some((part) => part === '..') ||
    /[\x00-\x1f]/.test(name)
  )
    throw new AppError('OVA 成员路径无效');
  return name;
}
/**
 * 入口 / Entry: paxValues.
 * 功能：在解析并导入外部磁盘及 OVA中，执行此领域的具体处理步骤并返回其结果；本入口产生 `values` 供上层消费（`disk-imports.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `disk-imports.ts`; this entry produces `values` for its caller. Module context: Parses external disks and OVA archives, bounding TAR members, paths and disk dependencies before import.
 * 处理：通过 `data.indexOf`, `data.subarray().toString`, `data.subarray`, `record.indexOf` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `data.indexOf`, `data.subarray().toString`, `data.subarray`, `record.indexOf`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: data: Buffer
 * 输出 / Returns: `values`.
 * 副作用 / Effects: 更新 / updates `values[record.slice(0, equal)]`, `at`.
 * 拒绝 / Refusals: 条件 / conditions `space < 0`; `!Number.isSafeInteger(length) || length < 4 || at + length > data.length`; `data[at + length - 1] !== 10`; 异常 / errors `new AppError('OVA PAX 记录损坏')`.
 */
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
/**
 * 入口 / Entry: readAt.
 * 功能：在解析并导入外部磁盘及 OVA中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `data` 供上层消费（`disk-imports.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `disk-imports.ts`; this entry produces `data` for its caller. Module context: Parses external disks and OVA archives, bounding TAR members, paths and disk dependencies before import.
 * 处理：通过 `file.read` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `file.read`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: Awaited<ReturnType<typeof open>>; size: number; offset: number
 * 输出 / Returns: `data`.
 * 副作用 / Effects: 更新 / updates `received`.
 * 拒绝 / Refusals: 条件 / conditions `!bytesRead`; 异常 / errors `new AppError('OVA 归档已截断')`.
 */
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
/**
 * 入口 / Entry: extractOva.
 * 功能：有界解析 OVA/TAR 和 OVF 引用，将唯一受支持磁盘成员写入受管目标。
 * Purpose: Parses bounded OVA/TAR/OVF references and extracts the sole supported disk member into a managed target.
 * 设计：校验全部成员、长度、重复路径和 OVF 对应关系；提取失败清理暂存并把失败记入原存储租约。
 * Design: Members, lengths, duplicates and OVF correspondence are verified; extraction failure cleans staging and retains lease cleanup failure.
 * 输入 / Inputs: archive: string; target: string; signal: AbortSignal optional; lease: StorageLease optional
 * 输出 / Returns: Promise<{ member: string; bytes: number }>；结果来自 / values from `storageRuntime.run( { owner: 'core:ova-extract', taskId: 'ova:' + randomUUID(), label: 'Extract validated OVA disk', mode: 'w…`; `{ member: disk.name, bytes: disk.size }`.
 * 副作用 / Effects: `seen.add`; `createWriteStream`; `createReadStream`; `file.close`; `rm`; 更新 / updates `name`, `length`, `pending`, `ovf`.
 * 拒绝 / Refusals: 条件 / conditions `++entries > 1024`; `pending && item.type !== 120`; `pending.size`; 异常 / errors `new AppError('OVA 条目过多')`; `new AppError('OVA PAX 文件长度无效')`.
 * 收尾：退出 try 区域时始终执行 `try { await file.close(); if (owned && !complete) await rm(target, { force: true }); } catch (error) { lease.cleanupPending(e…`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `try { await file.close(); if (owned && !complete) await rm(target, { force: true }); } catch (error) { lease.cleanupPending(e…`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `lease.cleanupPending(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `lease.cleanupPending(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function extractOva(
  archive: string,
  target: string,
  signal?: AbortSignal,
  lease?: StorageLease,
): Promise<{ member: string; bytes: number }> {
  if (!lease)
    return storageRuntime.run(
      {
        owner: 'core:ova-extract',
        taskId: 'ova:' + randomUUID(),
        label: 'Extract validated OVA disk',
        mode: 'write',
        paths: [archive, target],
        dynamicTemporary: [target],
        buffers: 2 * 1024 ** 2,
        files: 3,
        signal,
      },
      (owned) => extractOva(archive, target, signal, owned),
    );
  lease.assertActive();
  const file = await open(archive, 'r');
  let owned = false,
    complete = false;
  try {
    const size = (await file.stat()).size;
    let at = 0,
      entries = 0,
      pending: Record<string, string> | null = null;
    let disk: { name: string; offset: number; size: number } | undefined;
    let ovf: { name: string; references: string[] } | undefined;
    const seen = new Set<string>();
    while (at + 512 <= size) {
      signal?.throwIfAborted();
      if (++entries > 1024) throw new AppError('OVA 条目过多');
      const header = await readAt(file, 512, at);
      if (header.every((byte) => byte === 0)) break;
      const item = tarHeader(header);
      let name = item.name,
        length = item.size;
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
          const references = [
            ...contents.matchAll(/<(?:[\w.-]+:)?File\b[^>]*?\b(?:[\w.-]+:)?href\s*=\s*["']([^"']+)["']/gi),
          ].map((match) => match[1]);
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
    if (
      ovf.references.length !== 1 ||
      posix.normalize(posix.join(posix.dirname(ovf.name), safeMember(ovf.references[0]))) !== disk.name
    )
      throw new AppError('OVA 磁盘与 OVF 文件引用不一致');
    await lease.reserveTemporary(target, disk.size);
    const output = createWriteStream(target, { flags: 'wx', mode: 0o600 });
    output.once('open', () => {
      owned = true;
    });
    await pipeline(
      createReadStream(archive, { start: disk.offset, end: disk.offset + disk.size - 1 }),
      output,
      { signal },
    );
    complete = true;
    return { member: disk.name, bytes: disk.size };
  } finally {
    try {
      await file.close();
      if (owned && !complete) await rm(target, { force: true });
    } catch (error) {
      lease.cleanupPending(error);
      throw error;
    }
  }
}

export class DiskImports {
  /**
   * 入口 / Entry: DiskImports.constructor.
   * 功能：建立 DiskImports 的解析并导入外部磁盘及 OVA上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the DiskImports context for this module's responsibility: Parses external disks and OVA archives, bounding TAR members, paths and disk dependencies before import. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines) {}
  /**
   * 入口 / Entry: DiskImports.import.
   * 功能：校验导入格式与目标硬件，在暂存区转换外部磁盘并采用为新实例。
   * Purpose: Validates source format/target hardware, converts external disks in staging and adopts them as a new VM.
   * 设计：转换前拒绝外部 backing 依赖和不受支持组合；最终采用前检查磁盘与容量，失败关闭文件和暂存资源。
   * Design: External backing dependencies/unsupported combinations are refused; disk/capacity checks precede adoption and failure closes staging resources.
   * 输入 / Inputs: input: unknown; source: Readable; signal: AbortSignal optional
   * 输出 / Returns: `storageRuntime.run( { owner: 'core:disk-import', taskId: 'disk-import:' + randomUUID(), label: 'Import and convert external d…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async import(input: unknown, source: Readable, signal?: AbortSignal) {
    const request = diskImportSchema.parse(input);
    if (request.firmware === 'uefi') await requireUefiSupport(request.architecture);
    /**
     * 入口 / Entry: DiskImports.import.callback@241.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（storageRuntime.run）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (storageRuntime.run).
     * 输入 / Inputs: lease
     * 输出 / Returns: `{ vm, source: { format: request.format, bytes, sha256: checksum, virtualBytes: virtual, ...(ova ? { member: ova.member } : {}…`.
     * 副作用 / Effects: `mkdir`; `createHash`; `createWriteStream`; `header.close`; `qcow.close`.
     * 拒绝 / Refusals: 条件 / conditions `bytes < 512`; `request.sha256 && request.sha256 !== checksum`; `format === 'vmdk' && prefix.toString() !== 'KDMV'`; 异常 / errors `new AppError('镜像文件过小')`; `new AppError('镜像 SHA-256 与预期不符')`.
     * 收尾：退出 try 区域时始终执行 `if (!within(transfers, dir) || !basename(dir).startsWith('image-import-')) throw new Error('镜像导入临时路径超出受控目录');`; `try { await rm(dir, { recursive: true, force: true }); } catch (error) { lease.cleanupPending(error); throw error; }`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `if (!within(transfers, dir) || !basename(dir).startsWith('image-import-')) throw new Error('镜像导入临时路径超出受控目录');`; `try { await rm(dir, { recursive: true, force: true }); } catch (error) { lease.cleanupPending(error); throw error; }`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `lease.cleanupPending(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `lease.cleanupPending(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return storageRuntime.run(
      {
        owner: 'core:disk-import',
        taskId: 'disk-import:' + randomUUID(),
        label: 'Import and convert external disk',
        mode: 'write',
        paths: [DATA],
        dynamicTemporary: [DATA],
        buffers: 4 * 1024 ** 2,
        files: 8,
        signal,
      },
      async (lease) => {
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
              /**
               * 入口 / Entry: DiskImports.import.transform.
               * 功能：在解析并导入外部磁盘及 OVA中，执行此领域的具体处理步骤并返回其结果；本入口产生 `callback(new AppError('镜像文件超过 8 GiB', 413))` 供上层消费（`DiskImports`）。
               * Purpose: Executes the domain-specific processing steps and returns their outcome in `DiskImports`; this entry produces `callback(new AppError('镜像文件超过 8 GiB', 413))` for its caller. Module context: Parses external disks and OVA archives, bounding TAR members, paths and disk dependencies before import.
               * 处理：通过 `callback`, `hash.update` 协调依赖；下列分支决定是否继续、返回或拒绝。
               * Processing: Coordinates its dependencies through `callback`, `hash.update`; the branches below determine continuation, return or refusal.
               * 分支 / Branches: `bytes > MAX_UPLOAD`.
               * 输入 / Inputs: chunk: Buffer; _encoding; callback
               * 输出 / Returns: `callback(new AppError('镜像文件超过 8 GiB', 413))`.
               * 副作用 / Effects: `hash.update`; 更新 / updates `bytes`.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              transform(chunk: Buffer, _encoding, callback) {
                const payload = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                bytes += payload.length;
                if (bytes > MAX_UPLOAD) return callback(new AppError('镜像文件超过 8 GiB', 413));
                hash.update(payload);
                callback(null, payload);
              },
            }),
            storageGrowth(lease, upload, MAX_UPLOAD),
            createWriteStream(upload, { flags: 'wx', mode: 0o600 }),
            { signal },
          );
          signal?.throwIfAborted();
          if (bytes < 512) throw new AppError('镜像文件过小');
          const checksum = hash.digest('hex');
          if (request.sha256 && request.sha256 !== checksum) throw new AppError('镜像 SHA-256 与预期不符');
          const sourceDisk = request.format === 'ova' ? join(dir, 'ova-disk.vmdk') : upload;
          const format = request.format === 'ova' ? 'vmdk' : request.format;
          const ova = request.format === 'ova' ? await extractOva(upload, sourceDisk, signal, lease) : null;
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
          const info = JSON.parse(
            await this.machines.engine.run(
              'sakura-img',
              ['info', '-f', format, '--output=json', sourceDisk],
              { signal, timeoutMs: 60000 },
            ),
          );
          const virtual = info['virtual-size'];
          if (
            info.format !== format ||
            !Number.isSafeInteger(virtual) ||
            virtual <= 0 ||
            virtual > MAX_VIRTUAL
          )
            throw new AppError('镜像格式或虚拟容量无效：最大 128 GiB');
          if (
            info['backing-filename'] ||
            info['full-backing-filename'] ||
            info['format-specific']?.data?.['data-file']
          )
            throw new AppError('导入镜像不能依赖外部磁盘文件');
          if (format === 'vmdk') {
            const data = info['format-specific']?.data;
            const extents = data?.extents;
            if (
              !['monolithicSparse', 'streamOptimized'].includes(data?.['create-type']) ||
              (data?.['parent-cid'] !== undefined && data['parent-cid'] !== 0xffffffff) ||
              !Array.isArray(extents) ||
              extents.length !== 1 ||
              typeof extents[0]?.filename !== 'string' ||
              resolve(dirname(sourceDisk), extents[0].filename).toLowerCase() !==
                resolve(sourceDisk).toLowerCase()
            )
              throw new AppError('仅支持无父磁盘的独立单文件 VMDK');
          }
          const disk = join(dir, 'disk.qcow2');
          const diskGiB = Math.max(
            2,
            distroInfo(request.distro, request.architecture).minimumDisk,
            Math.ceil(virtual / GiB),
          );
          const measured = JSON.parse(
            await this.machines.engine.run(
              'sakura-img',
              ['measure', '--output=json', '-f', format, '-O', 'qcow2', '-o', 'compat=1.1', sourceDisk],
              { signal },
            ),
          );
          if (
            !Number.isSafeInteger(measured.required) ||
            measured.required < 1 ||
            measured.required > 32 * GiB
          )
            throw new AppError('转换后的镜像空间预算无效', 507, 'STORAGE_SPACE_REQUIRED');
          await lease.reserveTemporary(disk, measured.required + 1024 ** 2);
          await this.machines.engine.run(
            'sakura-img',
            ['convert', '-f', format, '-O', 'qcow2', '-o', 'compat=1.1', sourceDisk, disk],
            { signal, timeoutMs: 3600000 },
          );
          signal?.throwIfAborted();
          if (virtual < diskGiB * GiB)
            await this.machines.engine.run('sakura-img', ['resize', '-f', 'qcow2', disk, `${diskGiB}G`], {
              signal,
              timeoutMs: 60000,
            });
          if ((await stat(disk)).size > 32 * GiB) throw new AppError('转换后的 QCOW2 文件超过 32 GiB');
          const converted = JSON.parse(
            await this.machines.engine.run('sakura-img', ['info', '-f', 'qcow2', '--output=json', disk], {
              signal,
              timeoutMs: 60000,
            }),
          );
          if (
            converted.format !== 'qcow2' ||
            converted['virtual-size'] !== diskGiB * GiB ||
            converted['backing-filename'] ||
            converted['format-specific']?.data?.['data-file']
          )
            throw new AppError('转换后的磁盘未通过独立性校验');
          const qcow = await open(disk, 'r');
          try {
            validateDiskHeader(await readAt(qcow, 104, 0));
          } finally {
            await qcow.close();
          }
          signal?.throwIfAborted();
          const vm = await this.machines.importDisk(
            {
              name: request.name,
              distro: request.distro,
              architecture: request.architecture,
              memoryMiB: request.memoryMiB,
              cpus: request.cpus,
              accelerator: request.accelerator,
              firmware: request.firmware,
              diskGiB,
              forwards: [],
            },
            disk,
            { signal, pendingResize: virtual < diskGiB * GiB, storage: lease },
          );
          return {
            vm,
            source: {
              format: request.format,
              bytes,
              sha256: checksum,
              virtualBytes: virtual,
              ...(ova ? { member: ova.member } : {}),
            },
          };
        } finally {
          if (!within(transfers, dir) || !basename(dir).startsWith('image-import-'))
            throw new Error('镜像导入临时路径超出受控目录');
          try {
            await rm(dir, { recursive: true, force: true });
          } catch (error) {
            lease.cleanupPending(error);
            throw error;
          }
        }
      },
    );
  }
}
