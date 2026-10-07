/**
 * 模块职责：管理插件数据路径及版本化存储迁移，校验插件数据标识和版本边界。
 * Module purpose: Owns plugin paths and versioned data migration, validating data identifiers and version boundaries.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { z } from 'zod';
import { DATA } from './paths.ts';
import { readStore } from './local-store.ts';
import { serializedMetadata } from './metadata-queue.ts';
import { atomicMetadataWrite } from './metadata-io.ts';

const safeName = /^[a-z][a-z0-9-]{0,63}$/;
/**
 * 入口 / Entry: pluginDataFile.
 * 功能：在管理插件数据路径及版本化存储迁移中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(DATA, 'plugins', pluginId, `${name}.json`)` 供上层消费（`plugin-data.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-data.ts`; this entry produces `join(DATA, 'plugins', pluginId, `${name}.json`)` for its caller. Module context: Owns plugin paths and versioned data migration, validating data identifiers and version boundaries.
 * 处理：通过 `safeName.test`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `safeName.test`, `join`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: pluginId: string; name: string
 * 输出 / Returns: `join(DATA, 'plugins', pluginId, `${name}.json`)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!safeName.test(pluginId) || !safeName.test(name)`; 异常 / errors `new Error('插件数据标识无效')`.
 */
export function pluginDataFile(pluginId: string, name: string) {
  if (!safeName.test(pluginId) || !safeName.test(name)) throw new Error('插件数据标识无效');
  return join(DATA, 'plugins', pluginId, `${name}.json`);
}

/**
 * 签名 / Signature: DataMigration.DataMigration.
 * 功能：为管理插件数据路径及版本化存储迁移声明 DataMigration 的输入与结果契约，所属容器为 DataMigration。
 * Purpose: Declares the input/result contract for DataMigration in DataMigration. Module responsibility: Owns plugin paths and versioned data migration, validating data identifiers and version boundaries.
 * 输入 / Inputs: previous: unknown
 * 输出 / Returns: unknown.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
export type DataMigration = (previous: unknown) => unknown;
/**
 * 入口 / Entry: readVersionedStore.
 * 功能：在管理插件数据路径及版本化存储迁移中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `schema.parse(data)` 供上层消费（`plugin-data.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `plugin-data.ts`; this entry produces `schema.parse(data)` for its caller. Module context: Owns plugin paths and versioned data migration, validating data identifiers and version boundaries.
 * 处理：通过 `readStore`, `migrate`, `schema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `readStore`, `migrate`, `schema.parse`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: string; version: number; schema: z.ZodType<T>; fallback: () => T; migrations: Record<number, DataMigration> default={}
 * 输出 / Returns: Promise<T>；结果来自 / values from `schema.parse(data)`.
 * 副作用 / Effects: 更新 / updates `data`, `current`.
 * 拒绝 / Refusals: 条件 / conditions `!Number.isInteger(version) || version < 1`; `!Number.isInteger(current) || (current as number) < 0`; `(current as number) > version`; 异常 / errors `new Error('插件数据版本无效')`; `new Error(`插件数据版本过新：${current} > ${version}`)`.
 */
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

/**
 * 入口 / Entry: writeVersionedStore.
 * 功能：在管理插件数据路径及版本化存储迁移中，校验并提交领域状态变更；本入口产生 `serializedMetadata(file, true, async (mark) => { let existing: string | undefined; try { existing = await readFile(file, 'utf…` 供上层消费（`plugin-data.ts`）。
 * Purpose: Validates and commits a domain state change in `plugin-data.ts`; this entry produces `serializedMetadata(file, true, async (mark) => { let existing: string | undefined; try { existing = await readFile(file, 'utf…` for its caller. Module context: Owns plugin paths and versioned data migration, validating data identifiers and version boundaries.
 * 处理：通过 `schema.parse`, `resolve`, `serializedMetadata` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `schema.parse`, `resolve`, `serializedMetadata`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: string; version: number; schema: z.ZodType<T>; value: T
 * 输出 / Returns: `serializedMetadata(file, true, async (mark) => { let existing: string | undefined; try { existing = await readFile(file, 'utf…`.
 * 副作用 / Effects: 更新 / updates `file`.
 * 拒绝 / Refusals: 条件 / conditions `!Number.isInteger(version) || version < 1`; 异常 / errors `new Error('插件数据版本无效')`.
 */
export async function writeVersionedStore<T>(file: string, version: number, schema: z.ZodType<T>, value: T) {
  if (!Number.isInteger(version) || version < 1) throw new Error('插件数据版本无效');
  const contents = JSON.stringify({ schemaVersion: version, data: schema.parse(value) }, null, 2);
  file = resolve(file);
  /**
   * 入口 / Entry: writeVersionedStore.callback@47.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（serializedMetadata）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (serializedMetadata).
   * 输入 / Inputs: mark
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `mkdir`; `writeFile().catch`; `writeFile`; 更新 / updates `existing`.
   * 拒绝 / Refusals: 条件 / conditions `(error as NodeJS.ErrnoException).code !== 'ENOENT'`; `existing !== undefined`; `!Number.isInteger(prior) || (prior as number) < 0 || (prior as number) > version`; 异常 / errors `error`; `new Error('插件数据版本不兼容')`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
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
