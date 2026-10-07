/**
 * 模块职责：编码并验证 TPM/NVRAM 归档，约束文件名、重复项与总大小以绑定可信启动状态。
 * Module purpose: Encodes/verifies TPM/NVRAM archives with name, duplication and total-size bounds to preserve trusted-boot identity.
 */
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';

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

/**
 * 入口 / Entry: validateTrustedBootFiles.
 * 功能：在编码并验证 TPM/NVRAM 归档中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`trusted-boot-archive.ts`）。
 * Purpose: Checks admission, input or resource ownership in `trusted-boot-archive.ts`; the calls and state transitions below complete the operation. Module context: Encodes/verifies TPM/NVRAM archives with name, duplication and total-size bounds to preserve trusted-boot identity.
 * 处理：通过 `snapshot.files.map`, `snapshot.files.some`, `snapshot.files.reduce` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `snapshot.files.map`, `snapshot.files.some`, `snapshot.files.reduce`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: snapshot: TrustedBootFiles
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `typeof snapshot.enabled !== 'boolean' || snapshot.files.length > 16 || new Set(snapshot.files.map((file) => file.name)).size …`; 异常 / errors `new AppError('TPM 状态文件类型或大小无效', 409)`.
 */
export function validateTrustedBootFiles(snapshot: TrustedBootFiles) {
  if (typeof snapshot.enabled !== 'boolean' || snapshot.files.length > 16 ||
      new Set(snapshot.files.map((file) => file.name)).size !== snapshot.files.length ||
      snapshot.files.some((file) => !fileName.safeParse(file.name).success ||
        !Buffer.isBuffer(file.data) || file.data.length > MAX_TRUSTED_BOOT_FILE) ||
      snapshot.files.reduce((sum, file) => sum + file.data.length, 0) > MAX_TRUSTED_BOOT_TOTAL)
    throw new AppError('TPM 状态文件类型或大小无效', 409);
}

/**
 * 入口 / Entry: encodeTrustedBootArchive.
 * 功能：在编码并验证 TPM/NVRAM 归档中，转换协议或持久数据表示并保持调用边界；本入口产生 `trustedBootArchiveSchema.parse({ enabled: snapshot.enabled, files: snapshot.files.map(({ name, data }) => ({ name, size: data…` 供上层消费（`trusted-boot-archive.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `trusted-boot-archive.ts`; this entry produces `trustedBootArchiveSchema.parse({ enabled: snapshot.enabled, files: snapshot.files.map(({ name, data }) => ({ name, size: data…` for its caller. Module context: Encodes/verifies TPM/NVRAM archives with name, duplication and total-size bounds to preserve trusted-boot identity.
 * 处理：通过 `validateTrustedBootFiles`, `trustedBootArchiveSchema.parse`, `snapshot.files.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `validateTrustedBootFiles`, `trustedBootArchiveSchema.parse`, `snapshot.files.map`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: snapshot: TrustedBootFiles
 * 输出 / Returns: TrustedBootArchive；结果来自 / values from `trustedBootArchiveSchema.parse({ enabled: snapshot.enabled, files: snapshot.files.map(({ name, data }) => ({ name, size: data…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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

/**
 * 入口 / Entry: decodeTrustedBootArchive.
 * 功能：在编码并验证 TPM/NVRAM 归档中，转换协议或持久数据表示并保持调用边界；本入口产生 `{ enabled: archive.enabled, files: archive.files.map((file) => { const compressed = Buffer.from(file.gzip, 'base64'); if (com…` 供上层消费（`trusted-boot-archive.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `trusted-boot-archive.ts`; this entry produces `{ enabled: archive.enabled, files: archive.files.map((file) => { const compressed = Buffer.from(file.gzip, 'base64'); if (com…` for its caller. Module context: Encodes/verifies TPM/NVRAM archives with name, duplication and total-size bounds to preserve trusted-boot identity.
 * 处理：通过 `trustedBootArchiveSchema.parse`, `archive.files.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `trustedBootArchiveSchema.parse`, `archive.files.map`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: raw: unknown
 * 输出 / Returns: TrustedBootFiles；结果来自 / values from `{ enabled: archive.enabled, files: archive.files.map((file) => { const compressed = Buffer.from(file.gzip, 'base64'); if (com…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function decodeTrustedBootArchive(raw: unknown): TrustedBootFiles {
  const archive = trustedBootArchiveSchema.parse(raw);
  /**
   * 入口 / Entry: decodeTrustedBootArchive.callback@60.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（archive.files.map）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (archive.files.map).
   * 输入 / Inputs: file
   * 输出 / Returns: `{ name: file.name, data }`.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`; 更新 / updates `data`.
   * 拒绝 / Refusals: 条件 / conditions `compressed.toString('base64') !== file.gzip`; `data.length !== file.size || createHash('sha256').update(data).digest('hex') !== file.sha256`; 异常 / errors `new AppError('TPM 状态编码无效')`; `new AppError('TPM 状态压缩数据损坏或超限')`.
   * 失败处理：catch 分支执行 `throw new AppError('TPM 状态压缩数据损坏或超限');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('TPM 状态压缩数据损坏或超限');`; these statements determine whether a failure is absorbed or rejected again.
   */
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
