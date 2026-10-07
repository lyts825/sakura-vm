/**
 * 模块职责：管理插件数据路径及版本化存储迁移，校验插件数据标识和版本边界。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { z } from 'zod';
import { DATA } from './paths.ts';
import { readStore } from './local-store.ts';
import { serializedMetadata } from './metadata-queue.ts';
import { atomicMetadataWrite } from './metadata-io.ts';

const safeName = /^[a-z][a-z0-9-]{0,63}$/;
export function pluginDataFile(pluginId: string, name: string) {
  if (!safeName.test(pluginId) || !safeName.test(name)) throw new Error('插件数据标识无效');
  return join(DATA, 'plugins', pluginId, `${name}.json`);
}

export type DataMigration = (previous: unknown) => unknown;
export async function readVersionedStore<T>(
  file: string,
  version: number,
  schema: z.ZodType<T>,
  fallback: () => T,
  migrations: Record<number, DataMigration> = {},
): Promise<T> {
  if (!Number.isInteger(version) || version < 1) throw new Error('插件数据版本无效');
  const raw = await readStore<unknown>(file, () => ({ schemaVersion: version, data: fallback() }));
  const envelope = raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'schemaVersion' in raw;
  let current = envelope ? (raw as { schemaVersion: unknown }).schemaVersion : 0;
  if (!Number.isInteger(current) || (current as number) < 0) throw new Error('插件数据版本无效');
  if ((current as number) > version) throw new Error(`插件数据版本过新：${current} > ${version}`);
  let data = envelope ? (raw as { data?: unknown }).data : raw;
  if (envelope && !Object.hasOwn(raw, 'data')) throw new Error('插件数据缺少内容');
  while ((current as number) < version) {
    const migrate = migrations[current as number];
    if (!migrate) throw new Error(`插件数据缺少 ${current} → ${(current as number) + 1} 迁移`);
    data = migrate(data);
    current = (current as number) + 1;
  }
  return schema.parse(data);
}

export async function writeVersionedStore<T>(file: string, version: number, schema: z.ZodType<T>, value: T) {
  if (!Number.isInteger(version) || version < 1) throw new Error('插件数据版本无效');
  const contents = JSON.stringify({ schemaVersion: version, data: schema.parse(value) }, null, 2);
  file = resolve(file);
  return serializedMetadata(file, true, async (mark) => {
    let existing: string | undefined;
    try {
      existing = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (existing !== undefined) {
      const raw = JSON.parse(existing) as unknown;
      const prior =
        raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'schemaVersion' in raw
          ? (raw as { schemaVersion: unknown }).schemaVersion
          : 0;
      if (!Number.isInteger(prior) || (prior as number) < 0 || (prior as number) > version)
        throw new Error('插件数据版本不兼容');
      if ((prior as number) < version) {
        mark();
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.v${prior}.bak`, existing, { flag: 'wx', mode: 0o600, flush: true }).catch(
          (error) => {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          },
        );
      }
    }
    await atomicMetadataWrite(file, contents, undefined, mark);
  });
}
