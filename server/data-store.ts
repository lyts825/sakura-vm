/** 严格元数据存储与有界制品工具。 Strict metadata and bounded artifact helpers. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { DataScope } from '../shared/contracts/data-common.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import { AppError } from '../shared/errors.ts';
export type DataAuthorize = (scope: DataScope) => Promise<void> | void;
export const sameDataScope = (a: DataScope, b: DataScope) => a.vmId === b.vmId && a.projectId === b.projectId;
export function dataCanonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(dataCanonical).join(',') + ']';
  return (
    '{' +
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ':' + dataCanonical(v))
      .join(',') +
    '}'
  );
}
export const dataHash = (value: unknown) => createHash('sha256').update(dataCanonical(value)).digest('hex');
export class DataStore<T extends { id: string; scope: DataScope }> {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private metadata: PluginMetadata,
    private schema: z.ZodType<T>,
    private authorize: DataAuthorize,
  ) {}
  async list(scope: DataScope): Promise<T[]> {
    await this.authorize(scope);
    return (await this.all()).filter((v) => sameDataScope(v.scope, scope));
  }
  async all(): Promise<T[]> {
    const raw = (await this.metadata.read()).value;
    return z
      .array(this.schema)
      .max(10000)
      .parse(raw ?? []);
  }
  async get(scope: DataScope, id: string): Promise<T> {
    const found = (await this.list(scope)).find((v) => v.id === id);
    if (!found) throw new AppError('数据记录不存在', 404, 'DATA_NOT_FOUND');
    return found;
  }
  async change(scope: DataScope, edit: (records: T[]) => T | void, recovery = false): Promise<T | void> {
    const work = this.tail.then(async () => {
      if (!recovery) await this.authorize(scope);
      const snap = await this.metadata.read();
      const records = z
        .array(this.schema)
        .max(10000)
        .parse(snap.value ?? []);
      const result = edit(records);
      z.array(this.schema).max(10000).parse(records);
      if (!recovery) await this.authorize(scope);
      await this.metadata.replace(records, { expectedRevision: snap.revision });
      return result ? structuredClone(result) : undefined;
    });
    this.tail = work.catch(() => {});
    return work;
  }
  async put(scope: DataScope, row: T): Promise<T> {
    this.schema.parse(row);
    if (!sameDataScope(scope, row.scope)) throw new AppError('数据作用域不匹配', 409);
    return (await this.change(scope, (rows) => {
      if (rows.some((v) => v.id === row.id)) throw new AppError('数据记录已存在', 409);
      rows.push(row);
      return row;
    })) as T;
  }
  async close() {
    await this.tail;
  }
}
export async function dataPutBytes(
  artifacts: DeliveryArtifactsV1,
  scope: DataScope,
  path: string,
  bytes: Buffer,
  kind: 'source' | 'output' | 'report' | 'import' = 'output',
) {
  if (bytes.length > 1024 ** 3) throw new AppError('数据文件超过 1 GiB', 413);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const upload = await artifacts.begin(scope, { sha256, bytes: bytes.length });
  for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
    await artifacts.chunk(
      scope,
      upload.id,
      offset,
      bytes.subarray(offset, offset + 512 * 1024).toString('base64'),
    );
  const blob = await artifacts.complete(scope, upload.id);
  return artifacts.seal(scope, { label: path, kind, files: [{ path, ...blob, mode: 0o400 }] });
}
export async function dataReadBytes(
  artifacts: DeliveryArtifactsV1,
  scope: DataScope,
  manifestId: string,
  path: string,
  max = 8 * 1024 ** 2,
) {
  const manifest = await artifacts.get(scope, manifestId),
    file = manifest.files.find((v) => v.path === path);
  if (!file || file.bytes > max) throw new AppError('缺少文件或文件超过读取预算', 413);
  const lease = await artifacts.openRead(scope, manifestId);
  try {
    const chunks: Buffer[] = [];
    const hash = createHash('sha256');
    let offset = 0;
    while (offset < file.bytes) {
      const part = await artifacts.read(
          scope,
          file.blobId,
          offset,
          Math.min(512 * 1024, file.bytes - offset),
        ),
        bytes = Buffer.from(part.data, 'base64');
      if (!bytes.length || bytes.length > file.bytes - offset) throw new AppError('数据分块长度不符', 409);
      chunks.push(bytes);
      hash.update(bytes);
      offset += bytes.length;
    }
    if (hash.digest('hex') !== file.sha256) throw new AppError('数据摘要不符', 409);
    return Buffer.concat(chunks);
  } finally {
    await artifacts.closeRead(scope, lease.token);
  }
}
