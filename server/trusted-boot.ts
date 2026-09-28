import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Machines } from './machines.ts';
import { ROOT } from './model.ts';

type Paths = { qemu: string; secureFirmware: string; varsTemplate: string; swtpm: string };
const defaultPaths = (): Paths => {
  const root = process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu');
  return {
    qemu: join(root, `qemu-system-x86_64${process.platform === 'win32' ? '.exe' : ''}`),
    secureFirmware: join(root, 'share', 'edk2-x86_64-secure-code.fd'),
    varsTemplate: join(root, 'share', 'edk2-i386-vars.fd'),
    swtpm: process.env.SAKURA_SWTPM_PATH || 'swtpm',
  };
};

async function regularFirmware(path: string) {
  const info = await lstat(path).catch(() => null);
  return Boolean(info?.isFile() && !info.isSymbolicLink() && info.size >= 65536);
}

function commandOutput(file: string, args: string[]) {
  return new Promise<{ ok: boolean; output: string }>((resolve) => {
    execFile(file, args, { timeout: 5000, maxBuffer: 256 * 1024, windowsHide: true },
      (error, stdout, stderr) => resolve({ ok: !error, output: `${stdout}\n${stderr}` }));
  });
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

const flag = (value: string | undefined) => value === '1' ? true : value === '0' ? false : null;

export async function inspectTrustedBoot(machines: Machines, id: string,
  paths: Paths = defaultPaths(), signal?: AbortSignal) {
  const vm = machines.get(id);
  const [secureFirmware, varsTemplate, tpmBackend, machine, swtpm] = await Promise.all([
    regularFirmware(paths.secureFirmware),
    regularFirmware(paths.varsTemplate),
    commandOutput(paths.qemu, ['-tpmdev', 'help']),
    commandOutput(paths.qemu, ['-machine', 'q35,help']),
    commandOutput(paths.swtpm, ['--version']),
  ]);
  const host = {
    secureFirmware, varsTemplate,
    smm: machine.ok && /\bsmm=/.test(machine.output),
    tpmBackend: tpmBackend.ok && /\bemulator\b/.test(tpmBackend.output),
    swtpm: swtpm.ok,
  };
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
      host.tpmBackend && host.swtpm),
    executed: false,
    firmware: vm.firmware || 'bios',
    host,
    guest,
    observed,
    reason: !host.tpmBackend ? '当前 QEMU 构建不支持 TPM 后端。'
      : !host.swtpm ? '未找到 swtpm TPM 2.0 模拟器。'
        : !host.secureFirmware || !host.varsTemplate || !host.smm
          ? '当前 QEMU/OVMF 缺少安全启动固件、NVRAM 模板或 SMM。'
          : !guest?.efi ? '客户机尚未以 UEFI 启动。'
            : guest.secureBootEnabled !== true ? '客户机安全启动尚未启用或无法读取。'
              : guest.setupMode !== false ? '客户机尚未退出 UEFI 设置模式。'
              : !guest.tpmDevicePresent ? '客户机尚未识别 TPM 设备。' : null,
  };
}
