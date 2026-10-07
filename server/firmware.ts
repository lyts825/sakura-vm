/**
 * 模块职责：检测并准备 x86 与 ARM 的 UEFI 固件，缺少对应代码固件时拒绝启用。
 * Module purpose: Detects and prepares x86/ARM UEFI firmware, refusing enablement when matching code firmware is unavailable.
 */
import { constants, existsSync } from 'node:fs';
import { copyFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../shared/errors.ts';
import { ROOT, vmDir } from './paths.ts';
import { regularDirectory } from './local-store.ts';

/**
 * 入口 / Entry: paths.
 * 功能：在检测并准备 x86 与 ARM 的 UEFI 固件中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ code: '/usr/share/OVMF/OVMF_CODE_4M.fd', template: '/usr/share/OVMF/OVMF_VARS_4M.fd' }` / `bundled` 供上层消费（`firmware.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `firmware.ts`; this entry produces `{ code: '/usr/share/OVMF/OVMF_CODE_4M.fd', template: '/usr/share/OVMF/OVMF_VARS_4M.fd' }` / `bundled` for its caller. Module context: Detects and prepares x86/ARM UEFI firmware, refusing enablement when matching code firmware is unavailable.
 * 处理：通过 `join`, `existsSync` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `join`, `existsSync`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `architecture === 'x86_64' && process.platform === 'linux' && !existsSync(bundled.code) && existsSync…`.
 * 输入 / Inputs: architecture: 'x86_64' | 'aarch64' default='x86_64'
 * 输出 / Returns: `{ code: '/usr/share/OVMF/OVMF_CODE_4M.fd', template: '/usr/share/OVMF/OVMF_VARS_4M.fd' }`; `bundled`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function paths(architecture: 'x86_64' | 'aarch64' = 'x86_64') {
  const share = join(process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu'), 'share');
  const bundled = architecture === 'aarch64'
    ? { code: join(share, 'edk2-aarch64-code.fd'), template: join(share, 'edk2-arm-vars.fd') }
    : { code: join(share, 'edk2-x86_64-code.fd'), template: join(share, 'edk2-i386-vars.fd') };
  if (architecture === 'x86_64' && process.platform === 'linux' &&
      !existsSync(bundled.code) && existsSync('/usr/share/OVMF/OVMF_CODE_4M.fd'))
    return { code: '/usr/share/OVMF/OVMF_CODE_4M.fd',
      template: '/usr/share/OVMF/OVMF_VARS_4M.fd' };
  return bundled;
}
/**
 * 入口 / Entry: regularSize.
 * 功能：在检测并准备 x86 与 ARM 的 UEFI 固件中，执行此领域的具体处理步骤并返回其结果；本入口产生 `info?.isFile() && !info.isSymbolicLink() && info.size >= 65536 ? info.size : null` 供上层消费（`firmware.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `firmware.ts`; this entry produces `info?.isFile() && !info.isSymbolicLink() && info.size >= 65536 ? info.size : null` for its caller. Module context: Detects and prepares x86/ARM UEFI firmware, refusing enablement when matching code firmware is unavailable.
 * 处理：通过 `lstat().catch`, `lstat`, `info.isFile`, `info.isSymbolicLink` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `lstat().catch`, `lstat`, `info.isFile`, `info.isSymbolicLink`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: string
 * 输出 / Returns: `info?.isFile() && !info.isSymbolicLink() && info.size >= 65536 ? info.size : null`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
async function regularSize(file: string) {
  const info = await lstat(file).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  return info?.isFile() && !info.isSymbolicLink() && info.size >= 65536 ? info.size : null;
}

/**
 * 入口 / Entry: firmwareSupport.
 * 功能：在检测并准备 x86 与 ARM 的 UEFI 固件中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ available: codeBytes !== null && varsBytes !== null, codeBytes, varsBytes, reason: codeBytes === null ? architecture === 'a…` 供上层消费（`firmware.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `firmware.ts`; this entry produces `{ available: codeBytes !== null && varsBytes !== null, codeBytes, varsBytes, reason: codeBytes === null ? architecture === 'a…` for its caller. Module context: Detects and prepares x86/ARM UEFI firmware, refusing enablement when matching code firmware is unavailable.
 * 处理：通过 `paths`, `Promise.all`, `regularSize` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `paths`, `Promise.all`, `regularSize`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: architecture: 'x86_64' | 'aarch64' default='x86_64'
 * 输出 / Returns: `{ available: codeBytes !== null && varsBytes !== null, codeBytes, varsBytes, reason: codeBytes === null ? architecture === 'a…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function firmwareSupport(architecture: 'x86_64' | 'aarch64' = 'x86_64') {
  const { code, template } = paths(architecture);
  const [codeBytes, varsBytes] = await Promise.all([regularSize(code), regularSize(template)]);
  return {
    available: codeBytes !== null && varsBytes !== null,
    codeBytes,
    varsBytes,
    reason: codeBytes === null
      ? architecture === 'aarch64' ? '未找到可用的 ARM64 UEFI 固件代码'
        : '未找到可用的 x86_64 OVMF 固件代码'
      : varsBytes === null ? '未找到可用的 UEFI NVRAM 模板' : null,
  };
}

/**
 * 入口 / Entry: requireUefiSupport.
 * 功能：在检测并准备 x86 与 ARM 的 UEFI 固件中，核对调用资格、输入或资源归属；本入口产生 `support` 供上层消费（`firmware.ts`）。
 * Purpose: Checks admission, input or resource ownership in `firmware.ts`; this entry produces `support` for its caller. Module context: Detects and prepares x86/ARM UEFI firmware, refusing enablement when matching code firmware is unavailable.
 * 处理：通过 `firmwareSupport` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `firmwareSupport`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: architecture: 'x86_64' | 'aarch64' default='x86_64'
 * 输出 / Returns: `support`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!support.available`; 异常 / errors `new AppError(support.reason || 'OVMF 固件不可用', 503)`.
 */
export async function requireUefiSupport(architecture: 'x86_64' | 'aarch64' = 'x86_64') {
  const support = await firmwareSupport(architecture);
  if (!support.available) throw new AppError(support.reason || 'OVMF 固件不可用', 503);
  return support;
}

/**
 * 入口 / Entry: ensureUefiFirmware.
 * 功能：在检测并准备 x86 与 ARM 的 UEFI 固件中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ code, vars }` 供上层消费（`firmware.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `firmware.ts`; this entry produces `{ code, vars }` for its caller. Module context: Detects and prepares x86/ARM UEFI firmware, refusing enablement when matching code firmware is unavailable.
 * 处理：通过 `requireUefiSupport`, `paths`, `vmDir`, `regularDirectory` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `requireUefiSupport`, `paths`, `vmDir`, `regularDirectory`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string; architecture: 'x86_64' | 'aarch64' default='x86_64'
 * 输出 / Returns: `{ code, vars }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `(error as NodeJS.ErrnoException).code !== 'EEXIST'`; `size !== support.varsBytes`; 异常 / errors `error`; `new AppError('实例 UEFI NVRAM 文件无效或容量已变化')`.
 * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function ensureUefiFirmware(id: string, architecture: 'x86_64' | 'aarch64' = 'x86_64') {
  const support = await requireUefiSupport(architecture);
  const { code, template } = paths(architecture);
  const directory = vmDir(id);
  await regularDirectory(directory);
  const vars = join(directory, 'uefi-vars.fd');
  try {
    await copyFile(template, vars, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const size = await regularSize(vars);
  if (size !== support.varsBytes) throw new AppError('实例 UEFI NVRAM 文件无效或容量已变化');
  return { code, vars };
}
