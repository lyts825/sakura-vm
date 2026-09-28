import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, type VMRecord } from './model.ts';
import { secretName, Secrets } from './secrets.ts';
import type { Machines } from './machines.ts';

export const diskEncryptionSchema = z.object({
  format: z.literal('luks'),
  secretName,
}).strict();
export type DiskEncryptionConfig = z.infer<typeof diskEncryptionSchema>;

const secretId = 'sakura-disk-key';
const escape = (value: string) => value.replaceAll(',', ',,');

export function qemuSecretObject(file: string) {
  return `secret,id=${secretId},file=${escape(file)}`;
}

export function encryptedImageOptions(file: string) {
  return `driver=qcow2,file.filename=${escape(file)},encrypt.key-secret=${secretId}`;
}

export function plainImageOptions(file: string) {
  return `driver=qcow2,file.filename=${escape(file)}`;
}

export function encryptedDriveOption() {
  return `encrypt.key-secret=${secretId}`;
}

/** QEMU reads the secret file while opening the image. Never place it in argv or persistent VM data. */
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
    close: async () => {
      if (closed) return;
      closed = true;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function withDiskSecret<T>(machines: Machines, vm: VMRecord,
  action: (file: string) => Promise<T>) {
  if (!vm.diskEncryption) throw new AppError('此实例磁盘未启用加密', 409);
  const secret = await openDiskSecret(machines, vm.id, vm.diskEncryption.secretName);
  try { return await action(secret.file); }
  finally { await secret.close(); }
}
