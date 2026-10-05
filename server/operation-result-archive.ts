import { createHash } from 'node:crypto';
import { mkdir, lstat, open, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { operationResultArchiveRequest, operationResultPoolSchema, type OperationResultPool, type OperationResultDirectory } from '../shared/contracts/operation-results.ts';
import { writeStore, regularDirectory } from './local-store.ts';

export const OPERATION_ARCHIVE_LIMITS = Object.freeze({
  maxRecords: 4096, maxBytes: 64 * 1024 * 1024, maxRecordBytes: 64 * 1024,
});
const envelopeBytes = OPERATION_ARCHIVE_LIMITS.maxRecordBytes * 2;
const archiveTemporaryName = /^([a-f0-9-]{36})\.json\.([a-f0-9-]{36})\.tmp$/;
const authoritySchema = z.discriminatedUnion('sessionKey', [
  z.object({ role: z.literal('owner'), sessionKey: z.literal('account'), actorId: z.uuid() }).strict(),
  z.object({ role: z.literal('owner'), sessionKey: z.literal('local-owner') }).strict(),
]);
export type OperationArchiveAuthority = z.infer<typeof authoritySchema>;
const envelopeSchema = z.object({
  version: z.literal(1), correlationId: z.uuid(), pool: operationResultPoolSchema,
  digest: operationResultArchiveRequest.shape.digest, archivedAt: z.iso.datetime(),
  reason: operationResultArchiveRequest.shape.reason,
  authority: authoritySchema, raw: z.string().max(OPERATION_ARCHIVE_LIMITS.maxRecordBytes * 2),
}).strict();
export type ArchivedOperation = z.infer<typeof envelopeSchema>;
export const operationReceiptDigest = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
/** A single identity spelling is required on case-insensitive filesystems. */
export const operationReceiptId = (id: string) => z.uuid().parse(id).toLowerCase();

/** Archives are never expired automatically: a full archive is an operator-visible
 * storage boundary. Interrupted metadata temporaries remain untrusted evidence
 * and reserve capacity even if incomplete. Only a committed, validated envelope
 * permits a subsequent unlink, so interruption can be retried explicitly. */
export class OperationResultArchiveStore {
  constructor(private directory: string) {}
  file(id: string) { return join(this.directory, operationReceiptId(id) + '.json'); }
  async read(id: string, directoryChecked = false): Promise<ArchivedOperation | undefined> {
    id = operationReceiptId(id);
    if (!directoryChecked) await regularDirectory(this.directory);
    const file = this.file(id);
    const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!info) return;
    if (!info.isFile() || info.isSymbolicLink() || info.size > envelopeBytes)
      throw new AppError('操作结果档案不可用，证据未修改', 503, 'OPERATION_ARCHIVE_UNAVAILABLE');
    const handle = await open(file, 'r');
    try {
      const raw = Buffer.alloc(envelopeBytes + 1);
      const { bytesRead } = await handle.read(raw, 0, raw.length, 0);
      if (bytesRead > envelopeBytes) throw new Error('oversized archive');
      const archived = envelopeSchema.parse(JSON.parse(raw.subarray(0, bytesRead).toString('utf8')));
      const contents = Buffer.from(archived.raw, 'base64');
      if (archived.correlationId !== id || contents.length > OPERATION_ARCHIVE_LIMITS.maxRecordBytes ||
          contents.toString('base64') !== archived.raw || operationReceiptDigest(contents) !== archived.digest)
        throw new Error('archive identity or digest mismatch');
      return archived;
    } catch {
      throw new AppError('操作结果档案校验失败，证据未修改', 503, 'OPERATION_ARCHIVE_UNAVAILABLE');
    } finally { await handle.close(); }
  }
  async diagnostics(): Promise<OperationResultDirectory['archive']> {
    // Both committed archives and retained interrupted writes consume these
    // limits; repeated interruptions cannot grow an unaccounted evidence pool.
    let recordCount = 0, bytes = 0;
    try {
      await regularDirectory(this.directory);
      const names: string[] = [];
      const entries = await opendir(this.directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      // Diagnostics never create storage before an archive's authority recheck.
      if (entries) for await (const entry of entries) {
        if (++recordCount > OPERATION_ARCHIVE_LIMITS.maxRecords)
          return { recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: true,
            state: 'degraded' as const, code: 'OPERATION_ARCHIVES_FULL' };
        names.push(entry.name);
      }
      for (let offset = 0; offset < names.length; offset += 32) {
        const inspected = await Promise.allSettled(names.slice(offset, offset + 32).map(async (name) => {
          const info = await lstat(join(this.directory, name));
          const temporary = archiveTemporaryName.exec(name);
          const isTemporary = !!temporary && z.uuid().safeParse(temporary[1]).success &&
            z.uuid().safeParse(temporary[2]).success;
          if ((!/^[a-f0-9-]{36}\.json$/.test(name) && !isTemporary) || !info.isFile() || info.isSymbolicLink())
            throw new AppError('档案目录项无效', 503, 'OPERATION_ARCHIVE_UNAVAILABLE');
          if (info.size > envelopeBytes)
            throw new AppError('档案记录超过容量', 503, 'OPERATION_ARCHIVES_FULL');
          // A killed write may leave any prefix of an envelope. Keep and count
          // these bytes; never publish or trust them, including on explicit retry.
          if (!isTemporary) await this.read(name.slice(0, -5), true);
          return info.size;
        }));
        let code: string | undefined;
        for (const item of inspected) {
          if (item.status === 'fulfilled') bytes += item.value;
          else code ||= item.reason instanceof AppError ? item.reason.code : 'OPERATION_ARCHIVE_UNAVAILABLE';
        }
        if (code || bytes > OPERATION_ARCHIVE_LIMITS.maxBytes)
          return { recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: true,
            state: 'degraded' as const, code: code || 'OPERATION_ARCHIVES_FULL' };
      }
      return { recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS,
        full: recordCount >= OPERATION_ARCHIVE_LIMITS.maxRecords || bytes >= OPERATION_ARCHIVE_LIMITS.maxBytes,
        state: 'healthy' as const };
    } catch {
      return { recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: true,
        state: 'degraded' as const, code: 'OPERATION_ARCHIVE_UNAVAILABLE' };
    }
  }
  async preserve(id: string, pool: OperationResultPool, raw: Buffer,
    reason: ArchivedOperation['reason'], authority: OperationArchiveAuthority, check: () => Promise<void>) {
    id = operationReceiptId(id);
    authoritySchema.parse(authority);
    const digest = operationReceiptDigest(raw);
    const existing = await this.read(id);
    if (existing) {
      if (existing.pool !== pool || existing.digest !== digest)
        throw new AppError('归档标识已被不同证据占用', 409, 'OPERATION_ARCHIVE_CONFLICT');
      return existing;
    }
    const archived = envelopeSchema.parse({ version: 1, correlationId: id, pool, digest,
      archivedAt: new Date().toISOString(), reason, authority, raw: raw.toString('base64') });
    const size = Buffer.byteLength(JSON.stringify(archived, null, 2));
    const inventory = await this.diagnostics();
    if (raw.length > OPERATION_ARCHIVE_LIMITS.maxRecordBytes || inventory.state !== 'healthy' ||
        inventory.recordCount >= OPERATION_ARCHIVE_LIMITS.maxRecords ||
        inventory.bytes + size > OPERATION_ARCHIVE_LIMITS.maxBytes)
      throw new AppError('操作结果档案容量不足，原证据已保留；请先导出保管并迁移旧档案', 503,
        inventory.code || 'OPERATION_ARCHIVES_FULL');
    await check();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeStore(this.file(id), archived);
    return archived;
  }
}
