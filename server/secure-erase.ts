import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { z } from 'zod';
import { AppError, ROOT } from './model.ts';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';

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
function guestScript() {
  return (script ||= readFile(join(ROOT, 'server', 'secure-erase.py'), 'utf8').catch(() =>
    readFile(join(ROOT, '.sakura-server', 'assets', 'secure-erase.py'), 'utf8')));
}

export async function checkSecureErase(machines: Machines, workspaces: Workspaces,
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

export async function runSecureErase(machines: Machines, workspaces: Workspaces,
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
