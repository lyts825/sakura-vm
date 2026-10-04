import { lstat, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import type { DomainRecoveryTicket } from '../shared/contracts/domain-recovery.ts';

const revision = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function invalidRecoveryTicket(file: string, vmId: string, error: unknown, projectId?: string): DomainRecoveryTicket {
  return { id: 'invalid:' + revision(file), revision: (error as { recoveryRevision?: string })?.recoveryRevision || revision(String(error)),
    vmId, projectId, state: 'pending', available: false, error: String(error).slice(0, 1024) };
}

/** Recovery discovery observes bounded, ordinary files and never invokes a domain mutation. */
export async function readRecoveryJson(file: string, maxBytes = 32 * 1024 ** 2): Promise<unknown | undefined> {
  const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!info) return undefined;
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) {
    const error = new AppError('恢复票据文件类型或大小无效', 503, 'DOMAIN_RECOVERY_CORRUPT');
    Object.assign(error, { recoveryRevision: revision({ file, size: info.size, mtimeMs: info.mtimeMs, mode: info.mode, ino: info.ino }) });
    throw error;
  }
  const bytes = await readFile(file, 'utf8');
  try { return JSON.parse(bytes); }
  catch (error) { Object.assign(error as object, { recoveryRevision: createHash('sha256').update(bytes).digest('hex') }); throw error; }
}
export async function recoveryDirectories(root: string, valid: (name: string) => boolean, max = 4096): Promise<string[]> {
  const info = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!info) return [];
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new AppError('恢复票据目录类型无效', 503, 'DOMAIN_RECOVERY_CORRUPT');
  const names = (await readdir(root, { withFileTypes: true }))
    .filter(item => (item.isDirectory() || item.isSymbolicLink()) && valid(item.name)).map(item => item.name).sort();
  if (names.length > max) throw new AppError('恢复票据目录超过发现上限', 503, 'DOMAIN_RECOVERY_CAPACITY');
  return names;
}
