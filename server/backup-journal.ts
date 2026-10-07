/**
 * 模块职责：定义备份发布日志与文件身份约束，为中断后的发布恢复保留可验证票据。
 * Module purpose: Defines backup publication journals and file identity constraints so interrupted publication retains verifiable recovery tickets.
 */
import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { metadataFile } from './metadata-store.ts';
import { recoveryOriginSchema } from '../shared/contracts/domain-recovery.ts';

const directory = z.string().max(4096).refine(isAbsolute).optional();
export const backupJournalRecord = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    bytes: z.number().int().nonnegative(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    verifiedAt: z.iso.datetime().optional(),
    error: z.string().optional(),
    directory,
    encrypted: z.boolean().optional(),
    passwordSecret: z.string().optional(),
    retainUntil: z.string().optional(),
    storage: z.literal('blocks').optional(),
  })
  .strict();
export const backupPublicationSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    encrypted: z.boolean(),
    directory,
    deduplicate: z.boolean(),
    record: backupJournalRecord.optional(),
    obsolete: z.array(backupJournalRecord).max(1024),
    origin: recoveryOriginSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.record ||
      (value.record.id === value.id &&
        value.record.directory === value.directory &&
        Boolean(value.record.encrypted) === value.encrypted &&
        (value.record.storage === 'blocks') === value.deduplicate),
    '备份发布日志与已验证文件身份不符',
  );
export type BackupPublication = z.infer<typeof backupPublicationSchema>;
/**
 * 入口 / Entry: backupPublication.
 * 功能：把本层请求转交 `metadataFile`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `metadataFile` and propagates the provider result or rejection.
 * 输入 / Inputs: file: string
 * 输出 / Returns: `metadataFile<BackupPublication | null>( file, () => null, (value) => (value === null ? null : backupPublicationSchema.parse(v…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const backupPublication = (file: string) =>
  metadataFile<BackupPublication | null>(
    file,
    () => null,
    (value) => (value === null ? null : backupPublicationSchema.parse(value)),
  );
