/**
 * 模块职责：有界读取恢复票据文件和目录，拒绝无效类型、尺寸及超量发现结果。
 * Module purpose: Reads recovery files and directories within discovery bounds, rejecting invalid types, sizes and excessive entries.
 */
import { lstat, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import type { DomainRecoveryTicket } from '../shared/contracts/domain-recovery.ts';

/**
 * 入口 / Entry: revision.
 * 功能：在有界读取恢复票据文件和目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(JSON.stringify(value)).digest('hex')` 供上层消费（`domain-recovery-files.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `domain-recovery-files.ts`; this entry produces `createHash('sha256').update(JSON.stringify(value)).digest('hex')` for its caller. Module context: Reads recovery files and directories within discovery bounds, rejecting invalid types, sizes and excessive entries.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: `createHash('sha256').update(JSON.stringify(value)).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const revision = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/**
 * 入口 / Entry: invalidRecoveryTicket.
 * 功能：从当前输入或状态计算 `{ id: 'invalid:' + revision(file), revision: (error as { recoveryRevision?: string })?.recoveryRevision || revision(String(er…`，供调用方后续验证或使用。
 * Purpose: Computes `{ id: 'invalid:' + revision(file), revision: (error as { recoveryRevision?: string })?.recoveryRevision || revision(String(er…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: file: string; vmId: string; error: unknown; projectId: string optional
 * 输出 / Returns: DomainRecoveryTicket；结果来自 / values from `{ id: 'invalid:' + revision(file), revision: (error as { recoveryRevision?: string })?.recoveryRevision || revision(String(er…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function invalidRecoveryTicket(file: string, vmId: string, error: unknown, projectId?: string): DomainRecoveryTicket {
  return { id: 'invalid:' + revision(file), revision: (error as { recoveryRevision?: string })?.recoveryRevision || revision(String(error)),
    vmId, projectId, state: 'pending', available: false, error: String(error).slice(0, 1024) };
}

/** Recovery discovery observes bounded, ordinary files and never invokes a domain mutation. */
/**
 * 入口 / Entry: readRecoveryJson.
 * 功能：在有界读取恢复票据文件和目录中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `undefined` / `JSON.parse(bytes)` 供上层消费（`domain-recovery-files.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `domain-recovery-files.ts`; this entry produces `undefined` / `JSON.parse(bytes)` for its caller. Module context: Reads recovery files and directories within discovery bounds, rejecting invalid types, sizes and excessive entries.
 * 处理：通过 `lstat().catch`, `lstat`, `info.isFile`, `info.isSymbolicLink` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `lstat().catch`, `lstat`, `info.isFile`, `info.isSymbolicLink`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!info`.
 * 输入 / Inputs: file: string; maxBytes: default=32 * 1024 ** 2
 * 输出 / Returns: Promise<unknown | undefined>；结果来自 / values from `undefined`; `JSON.parse(bytes)`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 拒绝 / Refusals: 条件 / conditions `!info.isFile() || info.isSymbolicLink() || info.size > maxBytes`; 异常 / errors `error`.
 * 失败处理：catch 分支执行 `Object.assign(error as object, { recoveryRevision: createHash('sha256').update(bytes).digest('hex') });`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `Object.assign(error as object, { recoveryRevision: createHash('sha256').update(bytes).digest('hex') });`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
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
/**
 * 入口 / Entry: recoveryDirectories.
 * 功能：在有界读取恢复票据文件和目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[]` / `names` 供上层消费（`domain-recovery-files.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `domain-recovery-files.ts`; this entry produces `[]` / `names` for its caller. Module context: Reads recovery files and directories within discovery bounds, rejecting invalid types, sizes and excessive entries.
 * 处理：通过 `lstat().catch`, `lstat`, `info.isDirectory`, `info.isSymbolicLink` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `lstat().catch`, `lstat`, `info.isDirectory`, `info.isSymbolicLink`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!info`.
 * 输入 / Inputs: root: string; valid: (name: string) => boolean; max: default=4096
 * 输出 / Returns: Promise<string[]>；结果来自 / values from `[]`; `names`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!info.isDirectory() || info.isSymbolicLink()`; `names.length > max`; 异常 / errors `new AppError('恢复票据目录类型无效', 503, 'DOMAIN_RECOVERY_CORRUPT')`; `new AppError('恢复票据目录超过发现上限', 503, 'DOMAIN_RECOVERY_CAPACITY')`.
 */
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
