import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { z } from 'zod';
import { AppError } from './model.ts';

export const MAX_TRUSTED_BOOT_FILE = 16 * 1024 ** 2;
export const MAX_TRUSTED_BOOT_TOTAL = 32 * 1024 ** 2;
const fileName = z.string().refine((name) =>
  name === 'uefi-secure-vars.fd' ||
  /^tpm2\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/.test(name),
  'TPM 状态文件名无效');
const fileSchema = z.object({
  name: fileName,
  size: z.number().int().min(0).max(MAX_TRUSTED_BOOT_FILE),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  gzip: z.string().max(8 * 1024 ** 2),
}).strict();
export const trustedBootArchiveSchema = z.object({
  enabled: z.boolean(),
  files: z.array(fileSchema).max(16),
}).strict().superRefine((value, context) => {
  if (new Set(value.files.map((file) => file.name)).size !== value.files.length)
    context.addIssue({ code: 'custom', message: 'TPM 状态文件重复' });
  if (value.files.reduce((sum, file) => sum + file.size, 0) > MAX_TRUSTED_BOOT_TOTAL)
    context.addIssue({ code: 'custom', message: 'TPM 状态总量超限' });
});

export type TrustedBootArchive = z.infer<typeof trustedBootArchiveSchema>;
export type TrustedBootFiles = { enabled: boolean; files: { name: string; data: Buffer }[] };

export function validateTrustedBootFiles(snapshot: TrustedBootFiles) {
  if (typeof snapshot.enabled !== 'boolean' || snapshot.files.length > 16 ||
      new Set(snapshot.files.map((file) => file.name)).size !== snapshot.files.length ||
      snapshot.files.some((file) => !fileName.safeParse(file.name).success ||
        !Buffer.isBuffer(file.data) || file.data.length > MAX_TRUSTED_BOOT_FILE) ||
      snapshot.files.reduce((sum, file) => sum + file.data.length, 0) > MAX_TRUSTED_BOOT_TOTAL)
    throw new AppError('TPM 状态文件类型或大小无效', 409);
}

export function encodeTrustedBootArchive(snapshot: TrustedBootFiles): TrustedBootArchive {
  validateTrustedBootFiles(snapshot);
  return trustedBootArchiveSchema.parse({
    enabled: snapshot.enabled,
    files: snapshot.files.map(({ name, data }) => ({
      name,
      size: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      gzip: gzipSync(data).toString('base64'),
    })),
  });
}

export function decodeTrustedBootArchive(raw: unknown): TrustedBootFiles {
  const archive = trustedBootArchiveSchema.parse(raw);
  return {
    enabled: archive.enabled,
    files: archive.files.map((file) => {
      const compressed = Buffer.from(file.gzip, 'base64');
      if (compressed.toString('base64') !== file.gzip)
        throw new AppError('TPM 状态编码无效');
      let data: Buffer;
      try {
        data = gunzipSync(compressed, { maxOutputLength: MAX_TRUSTED_BOOT_FILE + 1 });
      } catch {
        throw new AppError('TPM 状态压缩数据损坏或超限');
      }
      if (data.length !== file.size ||
          createHash('sha256').update(data).digest('hex') !== file.sha256)
        throw new AppError('TPM 状态校验失败');
      return { name: file.name, data };
    }),
  };
}
