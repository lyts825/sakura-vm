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
export const backupPublication = (file: string) =>
  metadataFile<BackupPublication | null>(
    file,
    () => null,
    (value) => (value === null ? null : backupPublicationSchema.parse(value)),
  );
