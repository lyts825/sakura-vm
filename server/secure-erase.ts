/**
 * 模块职责：检查并执行客户机文件安全擦除，限制输入为项目内普通文件的相对路径。
 * Module purpose: Checks/runs guest logical file erasure for project-relative regular-file inputs.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { ROOT } from './paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';

const relativeFile = z.string().min(1).max(4096).refine((value) =>
  !value.startsWith('/') && !value.includes('\\') &&
  !/[\x00-\x1f]/.test(value) &&
  value.split('/').every((part) => !!part && part !== '.' && part !== '..'),
  '需要项目内的普通文件相对路径');

export const secureEraseInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('preview'), path: relativeFile }).strict(),
  z.object({ mode: z.literal('erase'), path: relativeFile,
    previewToken: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict(),
]);

let script: Promise<string> | undefined;
/**
 * 入口 / Entry: guestScript.
 * 功能：在检查并执行客户机文件安全擦除中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(script ||= readFile(join(ROOT, 'server', 'secure-erase.py'), 'utf8').catch(() => readFile(join(ROOT, '.sakura-server', 'asse…` 供上层消费（`secure-erase.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `secure-erase.ts`; this entry produces `(script ||= readFile(join(ROOT, 'server', 'secure-erase.py'), 'utf8').catch(() => readFile(join(ROOT, '.sakura-server', 'asse…` for its caller. Module context: Checks/runs guest logical file erasure for project-relative regular-file inputs.
 * 处理：通过 `readFile().catch`, `readFile`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `readFile().catch`, `readFile`, `join`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `(script ||= readFile(join(ROOT, 'server', 'secure-erase.py'), 'utf8').catch(() => readFile(join(ROOT, '.sakura-server', 'asse…`.
 * 副作用 / Effects: 更新 / updates `script`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function guestScript() {
  return (script ||= readFile(join(ROOT, 'server', 'secure-erase.py'), 'utf8').catch(() =>
    readFile(join(ROOT, '.sakura-server', 'assets', 'secure-erase.py'), 'utf8')));
}

/**
 * 入口 / Entry: checkSecureErase.
 * 功能：在检查并执行客户机文件安全擦除中，核对调用资格、输入或资源归属；本入口产生 `{ ready: false, executed: false, reason: '请先启动实例。' }` / `{ ready: false, executed: false, reason: '当前项目目录不在 /workspace 内；请先选择受控项目目录。' }` 供上层消费（`secure-erase.ts`）。
 * Purpose: Checks admission, input or resource ownership in `secure-erase.ts`; this entry produces `{ ready: false, executed: false, reason: '请先启动实例。' }` / `{ ready: false, executed: false, reason: '当前项目目录不在 /workspace 内；请先选择受控项目目录。' }` for its caller. Module context: Checks/runs guest logical file erasure for project-relative regular-file inputs.
 * 处理：通过 `machines.state`, `posix.normalize`, `workspaces.config`, `root.startsWith` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `machines.state`, `posix.normalize`, `workspaces.config`, `root.startsWith`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `machines.state(id) !== 'running'`; `root !== '/workspace' && !root.startsWith('/workspace/')`.
 * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; id: string; signal: AbortSignal optional
 * 输出 / Returns: `{ ready: false, executed: false, reason: '请先启动实例。' }`; `{ ready: false, executed: false, reason: '当前项目目录不在 /workspace 内；请先选择受控项目目录。' }`; `{ ready: tool?.code === 0, executed: false, reason: tool?.code === 0 ? '只处理 /workspace 下项目中的单链接普通文件，先预览再确认三轮逻辑覆盖与删除。QCOW2、快照和…`.
 * 副作用 / Effects: `root.startsWith`; `machines.exec().catch`; `machines.exec`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function checkSecureErase(machines: Machines, workspaces: WorkspacesV1,
  id: string, signal?: AbortSignal) {
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, reason: '请先启动实例。' };
  const root = posix.normalize((await workspaces.config(id)).directory);
  if (root !== '/workspace' && !root.startsWith('/workspace/'))
    return { ready: false, executed: false,
      reason: '当前项目目录不在 /workspace 内；请先选择受控项目目录。' };
  const tool = await machines.exec(id, 'python3 --version', 10000, signal).catch(() => null);
  return { ready: tool?.code === 0, executed: false,
    reason: tool?.code === 0
      ? '只处理 /workspace 下项目中的单链接普通文件，先预览再确认三轮逻辑覆盖与删除。QCOW2、快照和 SSD 的旧物理块可能仍可恢复。'
      : '客户机需要 Python 3。' };
}

/**
 * 入口 / Entry: runSecureErase.
 * 功能：在检查并执行客户机文件安全擦除中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: true, executed: false, path: options.path, bytes: evidence.bytes, sha256Before: evidence.sha256Before, previewToken:…` / `{ ready: true, executed: true, logicalOnly: true, path: options.path, bytes: evidence.bytes, sha256Before: evidence.sha256Bef…` 供上层消费（`secure-erase.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `secure-erase.ts`; this entry produces `{ ready: true, executed: false, path: options.path, bytes: evidence.bytes, sha256Before: evidence.sha256Before, previewToken:…` / `{ ready: true, executed: true, logicalOnly: true, path: options.path, bytes: evidence.bytes, sha256Before: evidence.sha256Bef…` for its caller. Module context: Checks/runs guest logical file erasure for project-relative regular-file inputs.
 * 处理：通过 `secureEraseInput.parse`, `machines.requireUnlocked`, `machines.state`, `workspaces.config` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `secureEraseInput.parse`, `machines.requireUnlocked`, `machines.state`, `workspaces.config`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; id: string; input: unknown; signal: AbortSignal optional
 * 输出 / Returns: `{ ready: true, executed: false, path: options.path, bytes: evidence.bytes, sha256Before: evidence.sha256Before, previewToken:…`; `{ ready: true, executed: true, logicalOnly: true, path: options.path, bytes: evidence.bytes, sha256Before: evidence.sha256Bef…`.
 * 副作用 / Effects: `root.startsWith`; `target.startsWith`; `machines.exec`; 更新 / updates `evidence`.
 * 拒绝 / Refusals: 条件 / conditions `machines.state(id) !== 'running'`; `root !== '/workspace' && !root.startsWith('/workspace/')`; `!target.startsWith(root + '/')`; 异常 / errors `new AppError('请先启动实例', 409)`; `new AppError('逻辑擦除仅支持 /workspace 内的项目目录', 409)`.
 * 失败处理：catch 分支执行 `throw new AppError('客户机未返回有效擦除记录', 502);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `throw new AppError('客户机未返回有效擦除记录', 502);`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function runSecureErase(machines: Machines, workspaces: WorkspacesV1,
  id: string, input: unknown, signal?: AbortSignal) {
  const options = secureEraseInput.parse(input);
  machines.requireUnlocked(id);
  if (machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
  const project = await workspaces.config(id);
  const root = posix.normalize(project.directory);
  if (root !== '/workspace' && !root.startsWith('/workspace/'))
    throw new AppError('逻辑擦除仅支持 /workspace 内的项目目录', 409);
  const target = posix.join(root, options.path);
  if (!target.startsWith(root + '/')) throw new AppError('路径超出当前项目目录');
  signal?.throwIfAborted();
  const payload = Buffer.from(JSON.stringify({ action: options.mode, path: target,
    ...(options.mode === 'erase' ? { previewToken: options.previewToken } : {}) })).toString('base64');
  const source = Buffer.from(await guestScript()).toString('base64');
  const command = `python3 -c 'import base64;exec(base64.b64decode("${source}"))' '${payload}'`;
  const result = await machines.exec(id, command, 300000, signal);
  if (result.code !== 0)
    throw new AppError((result.stderr || '逻辑擦除未完成').trim().slice(0, 500),
      result.stderr.includes('预览已过期') ? 409 : 400);
  let evidence: Record<string, unknown>;
  try { evidence = JSON.parse(result.stdout.trim()); }
  catch { throw new AppError('客户机未返回有效擦除记录', 502); }
  if (evidence.path !== target || typeof evidence.sha256Before !== 'string' ||
      !/^[a-f0-9]{64}$/.test(evidence.sha256Before) ||
      typeof evidence.bytes !== 'number' || !Number.isSafeInteger(evidence.bytes) ||
      evidence.bytes < 0 || evidence.bytes > 128 * 1024 * 1024)
    throw new AppError('客户机擦除记录无效', 502);
  if (options.mode === 'preview') {
    if (typeof evidence.previewToken !== 'string' ||
        !/^[a-f0-9]{64}$/.test(evidence.previewToken))
      throw new AppError('客户机未返回有效预览令牌', 502);
    return { ready: true, executed: false, path: options.path,
      bytes: evidence.bytes, sha256Before: evidence.sha256Before,
      previewToken: evidence.previewToken,
      reason: '文件未修改。提交相同路径、预览令牌和 confirmed=true 后执行逻辑覆盖与删除。' };
  }
  if (evidence.removed !== true || evidence.passes !== 3 ||
      typeof evidence.sha256After !== 'string' ||
      !/^[a-f0-9]{64}$/.test(evidence.sha256After) ||
      typeof evidence.recordedAt !== 'string' ||
      !Number.isFinite(Date.parse(evidence.recordedAt)))
    throw new AppError('客户机未确认三轮覆盖和删除', 502);
  return { ready: true, executed: true, logicalOnly: true, path: options.path,
    bytes: evidence.bytes, sha256Before: evidence.sha256Before,
    sha256After: evidence.sha256After, passes: evidence.passes,
    removed: true, recordedAt: evidence.recordedAt };
}
