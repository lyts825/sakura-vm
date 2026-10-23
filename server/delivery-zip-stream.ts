/** 通过封存制品的分块端口读写 STORE ZIP，不在内存保留整包。 Stream STORE ZIP through sealed artifact chunks without whole-package buffering. */
import { createHash } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import type { DeliveryScope, DeliveryFile } from '../shared/contracts/delivery-common.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import { deliveryPaths } from './delivery-artifacts.ts';
// 整个 ZIP 作为一个制品，沿用 1 GiB 单文件上限；使用普通 32 位 STORE 头，不接受 ZIP64。
// The ZIP is one artifact with a 1 GiB file limit; standard 32-bit STORE headers suffice and ZIP64 is rejected.
const LIMIT = 1024 * 1024 * 1024,
  CHUNK = 512 * 1024;
/** 为每个字节值生成 CRC-32 查表项，无外部副作用。 Generate each byte's CRC-32 table entry without external effects. */
const table = Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
/** 用 bytes 更新 CRC 累积值 value，返回尚未最终异或的结果。 Update CRC accumulator value with bytes and return it before final XOR. */
const crcUpdate = (value: number, bytes: Buffer) => {
  for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8);
  return value;
};
/** 惰性 ZIP 条目；read(offset,length) 返回指定片段，调用方按声明 bytes 分块消费。 Lazy ZIP entry whose read(offset,length) returns a slice for chunked consumption within declared bytes. */
export type DeliveryZipEntry = {
  path: string;
  bytes: number;
  read: (offset: number, length: number) => Promise<Buffer>;
};
/** 将 path/bytes 包装成只读惰性条目，不复制或上传缓冲区。 Wrap path/bytes as a lazy entry without copying or uploading the buffer. */
export const memoryZipEntry = (path: string, bytes: Buffer): DeliveryZipEntry => ({
  path,
  bytes: bytes.length,
  read: async (offset, length) => bytes.subarray(offset, offset + length),
});
/** 将 scope/file 包装成 path 条目，读取经 artifacts 执行；创建包装时不读取。 Wrap scoped file as path, delegating reads to artifacts without reading during construction. */
export const artifactZipEntry = (
  artifacts: DeliveryArtifactsV1,
  scope: DeliveryScope,
  path: string,
  file: DeliveryFile,
): DeliveryZipEntry => ({
  path,
  bytes: file.bytes,
  read: async (offset, length) =>
    Buffer.from((await artifacts.read(scope, file.blobId, offset, length)).data, 'base64'),
});
/** 按 512 KiB 遍历 entry 并拒绝短读，逐块产出字节。 Yield entry in 512 KiB chunks and reject short reads. */
async function* chunks(entry: DeliveryZipEntry) {
  for (let offset = 0; offset < entry.bytes; offset += CHUNK) {
    const size = Math.min(CHUNK, entry.bytes - offset),
      bytes = await entry.read(offset, size);
    if (bytes.length !== size) throw new AppError('交付 ZIP 条目读取截断', 409);
    yield bytes;
  }
}
/**
 * 将 entries 写入 scope 的新制品，返回 path 对应文件描述；路径、数量和整包字节均受限。
 * Write entries to a new scoped artifact and return its path descriptor, with path/count/package-size limits.
 * 设计 / Design：分别遍历 CRC、包摘要和上传，避免整包缓冲；重复读取要求条目内容稳定。
 * Traverse CRC, package digest and upload separately to avoid whole-package buffering; entries must remain stable across reads.
 */
export async function writeDeliveryZip(
  artifacts: DeliveryArtifactsV1,
  scope: DeliveryScope,
  path: string,
  entries: DeliveryZipEntry[],
) {
  deliveryPaths(entries);
  if (
    entries.some(
      (entry) =>
        !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || Buffer.byteLength(entry.path) > 65535,
    )
  )
    throw new AppError('交付 ZIP 条目长度无效', 400);
  if (
    entries.length > 10000 ||
    entries.reduce((sum, entry) => sum + entry.bytes + 76 + 2 * Buffer.byteLength(entry.path), 22) > LIMIT
  )
    throw new AppError('交付包超过单文件 1 GiB 上限或 10000 个文件', 413);
  const checksums: number[] = [];
  for (const entry of entries) {
    let value = 0xffffffff;
    for await (const bytes of chunks(entry)) value = crcUpdate(value, bytes);
    checksums.push((value ^ 0xffffffff) >>> 0);
  }
  /** 按 entries 和已算 CRC 产出相同 ZIP 字节；仅中央目录驻留内存。 Yield deterministic ZIP bytes from entries and CRCs, buffering only the central directory. */
  async function* encode() {
    let offset = 0;
    const directory: Buffer[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i],
        name = Buffer.from(entry.path),
        head = Buffer.alloc(30),
        central = Buffer.alloc(46);
      head.writeUInt32LE(0x04034b50);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(0x800, 6);
      head.writeUInt32LE(checksums[i], 14);
      head.writeUInt32LE(entry.bytes, 18);
      head.writeUInt32LE(entry.bytes, 22);
      head.writeUInt16LE(name.length, 26);
      central.writeUInt32LE(0x02014b50);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x800, 8);
      central.writeUInt32LE(checksums[i], 16);
      central.writeUInt32LE(entry.bytes, 20);
      central.writeUInt32LE(entry.bytes, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE(offset, 42);
      directory.push(central, name);
      yield head;
      yield name;
      for await (const bytes of chunks(entry)) yield bytes;
      offset += 30 + name.length + entry.bytes;
    }
    const central = Buffer.concat(directory),
      end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    for (let offset = 0; offset < central.length; offset += CHUNK)
      yield central.subarray(offset, offset + CHUNK);
    yield end;
  }
  let bytes = 0;
  const hash = createHash('sha256');
  for await (const part of encode()) {
    hash.update(part);
    bytes += part.length;
  }
  if (bytes > LIMIT) throw new AppError('交付包超过单文件 1 GiB 上限', 413);
  const sha256 = hash.digest('hex'),
    upload = await artifacts.begin(scope, { sha256, bytes });
  let offset = 0;
  for await (const part of encode()) {
    await artifacts.chunk(scope, upload.id, offset, part.toString('base64'));
    offset += part.length;
  }
  return { path, ...(await artifacts.complete(scope, upload.id)), mode: 0o644 };
}
/** 分块校验 scope/file 的 STORE ZIP 目录、边界、路径和 CRC，返回受界限保护的惰性条目，不提取文件。 Validate scoped STORE ZIP directories, bounds, paths and CRC in chunks; return bounded lazy entries without extracting files. */
export async function readDeliveryZip(
  artifacts: DeliveryArtifactsV1,
  scope: DeliveryScope,
  file: DeliveryFile,
) {
  if (!Number.isSafeInteger(file.bytes) || file.bytes < 22 || file.bytes > LIMIT)
    throw new AppError('交付 ZIP 大小无效', 413);
  /** 在包边界内读取 offset/length，返回完整块或抛错，拒绝超 512 KiB 请求。 Read offset/length within package bounds, returning a full block or throwing; reject requests over 512 KiB. */
  const read = async (offset: number, length: number) => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > file.bytes ||
      length > CHUNK
    )
      throw new AppError('交付 ZIP 条目越界', 400);
    if (!length) return Buffer.alloc(0);
    const bytes = Buffer.from((await artifacts.read(scope, file.blobId, offset, length)).data, 'base64');
    if (bytes.length !== length) throw new AppError('交付 ZIP 已截断', 400);
    return bytes;
  };
  /** 以统一错误终止不受支持或不安全的 ZIP 解析。 Abort unsupported or unsafe ZIP parsing with a uniform error. */
  const fail = () => {
    throw new AppError('交付 ZIP 格式不安全或不受支持；仅接受无压缩 STORE 格式', 400);
  };
  const end = await read(file.bytes - 22, 22);
  if (end.readUInt32LE() !== 0x06054b50 || end.readUInt16LE(4) || end.readUInt16LE(6) || end.readUInt16LE(20))
    fail();
  const count = end.readUInt16LE(10),
    directoryStart = end.readUInt32LE(16),
    directorySize = end.readUInt32LE(12);
  if (count !== end.readUInt16LE(8) || count > 10000 || directoryStart + directorySize !== file.bytes - 22)
    fail();
  let cursor = directoryStart,
    localEnd = 0,
    total = 0;
  const entries = new Map<string, DeliveryZipEntry>();
  for (let i = 0; i < count; i++) {
    const central = await read(cursor, 46);
    if (central.readUInt32LE() !== 0x02014b50) fail();
    const flags = central.readUInt16LE(8),
      method = central.readUInt16LE(10),
      checksum = central.readUInt32LE(16),
      size = central.readUInt32LE(24),
      nameLength = central.readUInt16LE(28),
      local = central.readUInt32LE(42);
    if (
      flags !== 0x800 ||
      method ||
      central.readUInt32LE(20) !== size ||
      central.readUInt16LE(30) ||
      central.readUInt16LE(32) ||
      central.readUInt16LE(34) ||
      central.readUInt32LE(38) ||
      local !== localEnd ||
      !nameLength
    )
      fail();
    const nameBytes = await read(cursor + 46, nameLength),
      name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    if (entries.has(name) || name.endsWith('/')) fail();
    const head = await read(local, 30);
    if (
      head.readUInt32LE() !== 0x04034b50 ||
      head.readUInt16LE(6) !== flags ||
      head.readUInt16LE(8) !== method ||
      head.readUInt32LE(14) !== checksum ||
      head.readUInt32LE(18) !== size ||
      head.readUInt32LE(22) !== size ||
      head.readUInt16LE(26) !== nameLength ||
      head.readUInt16LE(28) ||
      !(await read(local + 30, nameLength)).equals(nameBytes)
    )
      fail();
    const start = local + 30 + nameLength;
    localEnd = start + size;
    if (localEnd > directoryStart) fail();
    const entry: DeliveryZipEntry = {
      path: name,
      bytes: size,
      read: async (offset, length) => {
        if (
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(length) ||
          offset < 0 ||
          length < 0 ||
          offset + length > size
        )
          throw new AppError('交付 ZIP 条目读取越界', 400);
        return read(start + offset, length);
      },
    };
    let crc = 0xffffffff;
    for await (const part of chunks(entry)) crc = crcUpdate(crc, part);
    if ((crc ^ 0xffffffff) >>> 0 !== checksum) fail();
    entries.set(name, entry);
    total += size;
    if (total > LIMIT) fail();
    cursor += 46 + nameLength;
  }
  if (cursor !== file.bytes - 22 || localEnd !== directoryStart) fail();
  deliveryPaths([...entries.values()]);
  return entries;
}
/** 读取不超过 limit 的 entry 到缓冲区；缺失或过大时拒绝。 Buffer entry only within limit, rejecting missing or oversized entries. */
export async function zipEntryBytes(entry: DeliveryZipEntry | undefined, limit: number) {
  if (!entry || entry.bytes > limit) throw new AppError('交付元数据缺失或超过限制', 400);
  const parts: Buffer[] = [];
  for await (const bytes of chunks(entry)) parts.push(bytes);
  return Buffer.concat(parts);
}
/** 分块读取 entry 并返回 SHA-256，不写入制品。 Stream entry into SHA-256 and return its digest without artifact writes. */
export async function zipEntryHash(entry: DeliveryZipEntry) {
  const hash = createHash('sha256');
  for await (const bytes of chunks(entry)) hash.update(bytes);
  return hash.digest('hex');
}
/** 将 entry 分块上传到 scope，返回采用 path/mode 的封存文件描述；不建立清单或执行许可。 Upload entry into scope in chunks and return a completed file descriptor using path/mode; create no manifest or execution grant. */
export async function importZipEntry(
  artifacts: DeliveryArtifactsV1,
  scope: DeliveryScope,
  entry: DeliveryZipEntry,
  path: string,
  mode: number,
) {
  const sha256 = await zipEntryHash(entry),
    upload = await artifacts.begin(scope, { sha256, bytes: entry.bytes });
  let offset = 0;
  for await (const bytes of chunks(entry)) {
    await artifacts.chunk(scope, upload.id, offset, bytes.toString('base64'));
    offset += bytes.length;
  }
  return { path, ...(await artifacts.complete(scope, upload.id)), mode };
}
