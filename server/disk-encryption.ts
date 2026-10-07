/**
 * 模块职责：生成 QEMU 加密磁盘参数并临时提供私密口令文件，作用域退出后清理口令载体。
 * Module purpose: Builds QEMU encrypted-disk arguments and temporary secret files, cleaning secret carriers when their scope ends.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { type VMRecord } from '../shared/contracts/vm.ts';
import { secretName, Secrets } from './secrets.ts';
import type { VmAccess as Machines } from './vm-access.ts';

export const diskEncryptionSchema = z.object({
  format: z.literal('luks'),
  secretName,
}).strict();
export type DiskEncryptionConfig = z.infer<typeof diskEncryptionSchema>;

const secretId = 'sakura-disk-key';
/**
 * 入口 / Entry: escape.
 * 功能：把本层请求转交 `value.replaceAll`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `value.replaceAll` and propagates the provider result or rejection.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `value.replaceAll(',', ',,')`.
 * 副作用 / Effects: `value.replaceAll`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const escape = (value: string) => value.replaceAll(',', ',,');

/**
 * 入口 / Entry: qemuSecretObject.
 * 功能：从当前输入或状态计算 ``secret,id=${secretId},file=${escape(file)}``，供调用方后续验证或使用。
 * Purpose: Computes ``secret,id=${secretId},file=${escape(file)}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: file: string
 * 输出 / Returns: ``secret,id=${secretId},file=${escape(file)}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function qemuSecretObject(file: string) {
  return `secret,id=${secretId},file=${escape(file)}`;
}

/**
 * 入口 / Entry: encryptedImageOptions.
 * 功能：从当前输入或状态计算 ``driver=qcow2,file.filename=${escape(file)},encrypt.key-secret=${secretId}``，供调用方后续验证或使用。
 * Purpose: Computes ``driver=qcow2,file.filename=${escape(file)},encrypt.key-secret=${secretId}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: file: string
 * 输出 / Returns: ``driver=qcow2,file.filename=${escape(file)},encrypt.key-secret=${secretId}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function encryptedImageOptions(file: string) {
  return `driver=qcow2,file.filename=${escape(file)},encrypt.key-secret=${secretId}`;
}

/**
 * 入口 / Entry: plainImageOptions.
 * 功能：从当前输入或状态计算 ``driver=qcow2,file.filename=${escape(file)}``，供调用方后续验证或使用。
 * Purpose: Computes ``driver=qcow2,file.filename=${escape(file)}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: file: string
 * 输出 / Returns: ``driver=qcow2,file.filename=${escape(file)}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function plainImageOptions(file: string) {
  return `driver=qcow2,file.filename=${escape(file)}`;
}

/**
 * 入口 / Entry: encryptedDriveOption.
 * 功能：从当前输入或状态计算 ``encrypt.key-secret=${secretId}``，供调用方后续验证或使用。
 * Purpose: Computes ``encrypt.key-secret=${secretId}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: ``encrypt.key-secret=${secretId}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function encryptedDriveOption() {
  return `encrypt.key-secret=${secretId}`;
}

/** QEMU reads the secret file while opening the image. Never place it in argv or persistent VM data. */
/**
 * 入口 / Entry: openDiskSecret.
 * 功能：在生成 QEMU 加密磁盘参数并临时提供私密口令文件中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ file, close: async () => { if (closed) return; closed = true; await rm(directory, { recursive: true, force: true }); }, }` 供上层消费（`disk-encryption.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `disk-encryption.ts`; this entry produces `{ file, close: async () => { if (closed) return; closed = true; await rm(directory, { recursive: true, force: true }); }, }` for its caller. Module context: Builds QEMU encrypted-disk arguments and temporary secret files, cleaning secret carriers when their scope ends.
 * 处理：通过 `Secrets.value`, `mkdtemp`, `join`, `tmpdir` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `Secrets.value`, `mkdtemp`, `join`, `tmpdir`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Machines; id: string; name: string
 * 输出 / Returns: `{ file, close: async () => { if (closed) return; closed = true; await rm(directory, { recursive: true, force: true }); }, }`.
 * 副作用 / Effects: `writeFile`; `rm`.
 * 拒绝 / Refusals: 条件 / conditions `value.length < 16 || value.length > 256`; 异常 / errors `new AppError('磁盘口令应为 16–256 个字符；请在私密配置中更新口令', 409)`; `error`.
 * 失败处理：catch 分支执行 `await rm(directory, { recursive: true, force: true });`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `await rm(directory, { recursive: true, force: true });`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function openDiskSecret(machines: Machines, id: string, name: string) {
  const value = await new Secrets(machines).value(id, name);
  if (value.length < 16 || value.length > 256)
    throw new AppError('磁盘口令应为 16–256 个字符；请在私密配置中更新口令', 409);
  const directory = await mkdtemp(join(tmpdir(), 'sakura-disk-secret-'));
  const file = join(directory, 'key');
  try {
    await writeFile(file, value, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  let closed = false;
  return {
    file,
    /**
     * 入口 / Entry: openDiskSecret.close.
     * 功能：在生成 QEMU 加密磁盘参数并临时提供私密口令文件中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`disk-encryption.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `disk-encryption.ts`; this entry produces `void` for its caller. Module context: Builds QEMU encrypted-disk arguments and temporary secret files, cleaning secret carriers when their scope ends.
     * 处理：通过 `rm` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `rm`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `closed`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `rm`; 更新 / updates `closed`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    close: async () => {
      if (closed) return;
      closed = true;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/**
 * 入口 / Entry: withDiskSecret.
 * 功能：在生成 QEMU 加密磁盘参数并临时提供私密口令文件中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await action(secret.file)` 供上层消费（`disk-encryption.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `disk-encryption.ts`; this entry produces `await action(secret.file)` for its caller. Module context: Builds QEMU encrypted-disk arguments and temporary secret files, cleaning secret carriers when their scope ends.
 * 处理：通过 `openDiskSecret`, `action`, `secret.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `openDiskSecret`, `action`, `secret.close`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Machines; vm: VMRecord; action: (file: string) => Promise<T>
 * 输出 / Returns: `await action(secret.file)`.
 * 副作用 / Effects: `secret.close`.
 * 拒绝 / Refusals: 条件 / conditions `!vm.diskEncryption`; 异常 / errors `new AppError('此实例磁盘未启用加密', 409)`.
 * 收尾：退出 try 区域时始终执行 `await secret.close();`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `await secret.close();`; these steps also apply to exceptional exits.
 */
export async function withDiskSecret<T>(machines: Machines, vm: VMRecord,
  action: (file: string) => Promise<T>) {
  if (!vm.diskEncryption) throw new AppError('此实例磁盘未启用加密', 409);
  const secret = await openDiskSecret(machines, vm.id, vm.diskEncryption.secretName);
  try { return await action(secret.file); }
  finally { await secret.close(); }
}
