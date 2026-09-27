import { constants } from 'node:fs';
import { copyFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError, ROOT, vmDir } from './model.ts';
import { regularDirectory } from './local-store.ts';

function paths() {
  const share = join(process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu'), 'share');
  return {
    code: join(share, 'edk2-x86_64-code.fd'),
    template: join(share, 'edk2-i386-vars.fd'),
  };
}
async function regularSize(file: string) {
  const info = await lstat(file).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  return info?.isFile() && !info.isSymbolicLink() && info.size >= 65536 ? info.size : null;
}

export async function firmwareSupport() {
  const { code, template } = paths();
  const [codeBytes, varsBytes] = await Promise.all([regularSize(code), regularSize(template)]);
  return {
    available: codeBytes !== null && varsBytes !== null,
    codeBytes,
    varsBytes,
    reason: codeBytes === null ? '未找到可用的 x86_64 OVMF 固件代码' : varsBytes === null ? '未找到可用的 OVMF NVRAM 模板' : null,
  };
}

export async function requireUefiSupport() {
  const support = await firmwareSupport();
  if (!support.available) throw new AppError(support.reason || 'OVMF 固件不可用', 503);
  return support;
}

export async function ensureUefiFirmware(id: string) {
  const support = await requireUefiSupport();
  const { code, template } = paths();
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
