/**
 * 模块职责：探测宿主可信启动支持并生成客户机检查命令，区分 QEMU 与 swtpm 能力。
 * Module purpose: Probes host trusted-boot support and constructs guest checks, distinguishing QEMU and swtpm capabilities.
 */
import { hostProcess } from './host-process.ts';
import { AppError } from '../shared/errors.ts';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { VmAccess as Machines } from './vm-access.ts';
import { ROOT } from './paths.ts';

export type TrustedBootPaths = { qemu: string; secureFirmware: string; varsTemplate: string; swtpm: string };
/**
 * 入口 / Entry: trustedBootPaths.
 * 功能：在探测宿主可信启动支持并生成客户机检查命令中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ qemu: join(root, `qemu-system-x86_64${process.platform === 'win32' ? '.exe' : ''}`), secureFirmware: process.env.SAKURA_SEC…` 供上层消费（`trusted-boot.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `trusted-boot.ts`; this entry produces `{ qemu: join(root, `qemu-system-x86_64${process.platform === 'win32' ? '.exe' : ''}`), secureFirmware: process.env.SAKURA_SEC…` for its caller. Module context: Probes host trusted-boot support and constructs guest checks, distinguishing QEMU and swtpm capabilities.
 * 处理：通过 `join`, `existsSync` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `join`, `existsSync`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: TrustedBootPaths；结果来自 / values from `{ qemu: join(root, `qemu-system-x86_64${process.platform === 'win32' ? '.exe' : ''}`), secureFirmware: process.env.SAKURA_SEC…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const trustedBootPaths = (): TrustedBootPaths => {
  const root = process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu');
  const bundledCode = join(root, 'share', 'edk2-x86_64-secure-code.fd');
  const bundledVars = join(root, 'share', 'edk2-x86_64-secure-vars.fd');
  return {
    qemu: join(root, `qemu-system-x86_64${process.platform === 'win32' ? '.exe' : ''}`),
    secureFirmware: process.env.SAKURA_SECURE_BOOT_CODE ||
      (existsSync(bundledCode) ? bundledCode : '/usr/share/OVMF/OVMF_CODE_4M.ms.fd'),
    varsTemplate: process.env.SAKURA_SECURE_BOOT_VARS ||
      (existsSync(bundledVars) ? bundledVars : '/usr/share/OVMF/OVMF_VARS_4M.ms.fd'),
    swtpm: process.env.SAKURA_SWTPM_PATH || 'swtpm',
  };
};

/**
 * 入口 / Entry: regularFirmware.
 * 功能：在探测宿主可信启动支持并生成客户机检查命令中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Boolean(info?.isFile() && info.size >= 65536)` 供上层消费（`trusted-boot.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `trusted-boot.ts`; this entry produces `Boolean(info?.isFile() && info.size >= 65536)` for its caller. Module context: Probes host trusted-boot support and constructs guest checks, distinguishing QEMU and swtpm capabilities.
 * 处理：通过 `stat().catch`, `stat`, `info.isFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `stat().catch`, `stat`, `info.isFile`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: path: string
 * 输出 / Returns: `Boolean(info?.isFile() && info.size >= 65536)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
async function regularFirmware(path: string) {
  const info = await stat(path).catch(() => null);
  return Boolean(info?.isFile() && info.size >= 65536);
}

/**
 * 入口 / Entry: commandOutput.
 * 功能：在探测宿主可信启动支持并生成客户机检查命令中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ok: result.code === 0, output: `${result.stdout}\n${result.stderr}` }` / `{ ok: false, output: '' }` 供上层消费（`trusted-boot.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `trusted-boot.ts`; this entry produces `{ ok: result.code === 0, output: `${result.stdout}\n${result.stderr}` }` / `{ ok: false, output: '' }` for its caller. Module context: Probes host trusted-boot support and constructs guest checks, distinguishing QEMU and swtpm capabilities.
 * 处理：通过 `hostProcess` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `hostProcess`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: string; args: string[]
 * 输出 / Returns: `{ ok: result.code === 0, output: `${result.stdout}\n${result.stderr}` }`; `{ ok: false, output: '' }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `error instanceof AppError && error.status === 503`; 异常 / errors `error`.
 * 失败处理：catch 分支执行 `if (error instanceof AppError && error.status === 503) throw error;`; `return { ok: false, output: '' };`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (error instanceof AppError && error.status === 503) throw error;`; `return { ok: false, output: '' };`; these statements determine whether a failure is absorbed or rejected again.
 */
async function commandOutput(file: string, args: string[]) {
  try {
    const result = await hostProcess('trusted-boot-probe', file, args, { timeout: 5000, maxBuffer: 256 * 1024 });
    return { ok: result.code === 0, output: `${result.stdout}\n${result.stderr}` };
  } catch (error) {
    if (error instanceof AppError && error.status === 503) throw error;
    return { ok: false, output: '' };
  }
}

/**
 * 入口 / Entry: supportsQmpRebootAction.
 * 功能：从当前输入或状态计算 `major !== undefined && Number(major) >= 6`，供调用方后续验证或使用。
 * Purpose: Computes `major !== undefined && Number(major) >= 6` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: version: string
 * 输出 / Returns: `major !== undefined && Number(major) >= 6`.
 * 副作用 / Effects: `inline.exec`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function supportsQmpRebootAction(version: string) {
  const major = /\bQEMU emulator version (\d+)\./.exec(version)?.[1];
  return major !== undefined && Number(major) >= 6;
}

export const guestTrustedBootScript = `set +e
printf 'EFI='; if [ -d /sys/firmware/efi ]; then echo yes; else echo no; fi
for name in SecureBoot SetupMode; do
  value=unknown
  for file in /sys/firmware/efi/efivars/$name-*; do
    if [ -f "$file" ]; then
      value=$(od -An -tu1 -j4 -N1 "$file" 2>/dev/null | tr -d '[:space:]')
      break
    fi
  done
  printf '%s=%s\\n' "$name" "$value"
done
printf 'TPM='; if [ -c /dev/tpmrm0 ] || [ -c /dev/tpm0 ]; then echo yes; else echo no; fi
`;

/**
 * 入口 / Entry: flag.
 * 功能：从当前输入或状态计算 `value === '1' ? true : value === '0' ? false : null`，供调用方后续验证或使用。
 * Purpose: Computes `value === '1' ? true : value === '0' ? false : null` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: string | undefined
 * 输出 / Returns: `value === '1' ? true : value === '0' ? false : null`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const flag = (value: string | undefined) => value === '1' ? true : value === '0' ? false : null;

/**
 * 入口 / Entry: probeTrustedBootHost.
 * 功能：在探测宿主可信启动支持并生成客户机检查命令中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ secureFirmware, varsTemplate, smm: machine.ok && /\bsmm=/.test(machine.output), tpmBackend: tpmBackend.ok && /\bemulator\b/…` 供上层消费（`trusted-boot.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `trusted-boot.ts`; this entry produces `{ secureFirmware, varsTemplate, smm: machine.ok && /\bsmm=/.test(machine.output), tpmBackend: tpmBackend.ok && /\bemulator\b/…` for its caller. Module context: Probes host trusted-boot support and constructs guest checks, distinguishing QEMU and swtpm capabilities.
 * 处理：通过 `Promise.all`, `regularFirmware`, `commandOutput`, `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `Promise.all`, `regularFirmware`, `commandOutput`, `inline.test`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: paths: TrustedBootPaths default=trustedBootPaths()
 * 输出 / Returns: `{ secureFirmware, varsTemplate, smm: machine.ok && /\bsmm=/.test(machine.output), tpmBackend: tpmBackend.ok && /\bemulator\b/…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function probeTrustedBootHost(paths: TrustedBootPaths = trustedBootPaths()) {
  const [secureFirmware, varsTemplate, tpmBackend, machine, swtpm, version] = await Promise.all([
    regularFirmware(paths.secureFirmware),
    regularFirmware(paths.varsTemplate),
    commandOutput(paths.qemu, ['-tpmdev', 'help']),
    commandOutput(paths.qemu, ['-machine', 'q35,help']),
    commandOutput(paths.swtpm, ['--version']),
    commandOutput(paths.qemu, ['--version']),
  ]);
  return {
    secureFirmware, varsTemplate,
    smm: machine.ok && /\bsmm=/.test(machine.output),
    tpmBackend: tpmBackend.ok && /\bemulator\b/.test(tpmBackend.output),
    swtpm: swtpm.ok,
    rebootAction: version.ok && supportsQmpRebootAction(version.output),
  };
}

/**
 * 入口 / Entry: inspectTrustedBoot.
 * 功能：在探测宿主可信启动支持并生成客户机检查命令中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ ready: Boolean(observed && host.secureFirmware && host.varsTemplate && host.smm && host.tpmBackend && host.swtpm && host.re…` 供上层消费（`trusted-boot.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `trusted-boot.ts`; this entry produces `{ ready: Boolean(observed && host.secureFirmware && host.varsTemplate && host.smm && host.tpmBackend && host.swtpm && host.re…` for its caller. Module context: Probes host trusted-boot support and constructs guest checks, distinguishing QEMU and swtpm capabilities.
 * 处理：通过 `machines.get`, `probeTrustedBootHost`, `machines.state`, `machines.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `machines.get`, `probeTrustedBootHost`, `machines.state`, `machines.exec`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `machines.state(id) === 'running'`; `result.code === 0`.
 * 输入 / Inputs: machines: Machines; id: string; paths: TrustedBootPaths default=trustedBootPaths(); signal: AbortSignal optional
 * 输出 / Returns: `{ ready: Boolean(observed && host.secureFirmware && host.varsTemplate && host.smm && host.tpmBackend && host.swtpm && host.re…`.
 * 副作用 / Effects: `machines.exec`; 更新 / updates `guest`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function inspectTrustedBoot(machines: Machines, id: string,
  paths: TrustedBootPaths = trustedBootPaths(), signal?: AbortSignal) {
  const vm = machines.get(id);
  const host = await probeTrustedBootHost(paths);
  let guest: { efi: boolean; secureBootEnabled: boolean | null;
    setupMode: boolean | null; tpmDevicePresent: boolean } | null = null;
  if (machines.state(id) === 'running') {
    const result = await machines.exec(id, guestTrustedBootScript, 10000, signal);
    if (result.code === 0) {
      const fields = Object.fromEntries(result.stdout.split(/\r?\n/)
        .filter((line) => /^[A-Za-z]+=(yes|no|unknown|0|1)$/.test(line))
        .map((line) => line.split('=', 2)));
      guest = { efi: fields.EFI === 'yes', secureBootEnabled: flag(fields.SecureBoot),
        setupMode: flag(fields.SetupMode), tpmDevicePresent: fields.TPM === 'yes' };
    }
  }
  const observed = guest?.efi === true && guest.secureBootEnabled === true &&
    guest.setupMode === false && guest.tpmDevicePresent;
  return {
    ready: Boolean(observed && host.secureFirmware && host.varsTemplate && host.smm &&
      host.tpmBackend && host.swtpm && host.rebootAction),
    executed: false,
    firmware: vm.firmware || 'bios',
    host,
    guest,
    observed,
    reason: !host.tpmBackend ? '当前 QEMU 构建不支持 TPM 后端。'
      : !host.swtpm ? '未找到 swtpm TPM 2.0 模拟器。'
      : !host.rebootAction ? '当前 QEMU 版本不支持启动后恢复客户机重启策略（需要 6.0 或更新版本）。'
        : !host.secureFirmware || !host.varsTemplate || !host.smm
          ? '当前 QEMU/OVMF 缺少安全启动固件、NVRAM 模板或 SMM。'
          : !guest?.efi ? '客户机尚未以 UEFI 启动。'
            : guest.secureBootEnabled !== true ? '客户机安全启动尚未启用或无法读取。'
              : guest.setupMode !== false ? '客户机尚未退出 UEFI 设置模式。'
              : !guest.tpmDevicePresent ? '客户机尚未识别 TPM 设备。' : null,
  };
}
