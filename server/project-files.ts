/**
 * 模块职责：扫描项目文件与搜索结果，限制搜索输入并观察取消信号。
 * Module purpose: Scans project files and search matches under input limits and cancellation.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { posix } from 'node:path';
import { isUtf8 } from 'node:buffer';
import type { FileEntry, SFTPWrapper } from 'ssh2';
import type { VmAccess as Machines } from './vm-access.ts';

import { AppError } from '../shared/errors.ts';

const excluded = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.data',
  '.tools',
  '.vendor',
  'target',
  'dist',
]);
/**
 * 入口 / Entry: kind.
 * 功能：从当前输入或状态计算 `entry.attrs.mode & 0xf000`，供调用方后续验证或使用。
 * Purpose: Computes `entry.attrs.mode & 0xf000` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: entry: FileEntry
 * 输出 / Returns: `entry.attrs.mode & 0xf000`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const kind = (entry: FileEntry) => entry.attrs.mode & 0xf000;
export type ProjectFile = { path: string; directory: boolean; size: number };
export type SearchMatch = { path: string; line: number; text: string };
/**
 * 入口 / Entry: textFile.
 * 功能：在扫描项目文件与搜索结果中，执行此领域的具体处理步骤并返回其结果；本入口产生 `isUtf8(bytes) && !bytes.includes(0) ? bytes.toString('utf8') : null` 供上层消费（`project-files.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-files.ts`; this entry produces `isUtf8(bytes) && !bytes.includes(0) ? bytes.toString('utf8') : null` for its caller. Module context: Scans project files and search matches under input limits and cancellation.
 * 处理：通过 `signal.throwIfAborted`, `ftp.createReadStream`, `signal.addEventListener`, `chunks.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `ftp.createReadStream`, `signal.addEventListener`, `chunks.push`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: ftp: SFTPWrapper; path: string; signal: AbortSignal
 * 输出 / Returns: `isUtf8(bytes) && !bytes.includes(0) ? bytes.toString('utf8') : null`.
 * 副作用 / Effects: `ftp.createReadStream`; `signal.addEventListener`; `chunks.push`; `stream.destroy`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 收尾：退出 try 区域时始终执行 `signal.removeEventListener('abort', abort);`; `stream.destroy();`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `signal.removeEventListener('abort', abort);`; `stream.destroy();`; these steps also apply to exceptional exits.
 */
async function textFile(ftp: SFTPWrapper, path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const stream = ftp.createReadStream(path, { start: 0, end: 1024 * 1024 - 1 });
  const closed = new Promise<void>((resolve) => stream.once('close', resolve));
  /**
   * 入口 / Entry: textFile.abort.
   * 功能：把本层请求转交 `stream.destroy`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `stream.destroy` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `stream.destroy(new AppError('搜索已取消'))`.
   * 副作用 / Effects: `stream.destroy`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const abort = () => stream.destroy(new AppError('搜索已取消'));
  signal.addEventListener('abort', abort, { once: true });
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      signal.throwIfAborted();
      chunks.push(Buffer.from(chunk));
    }
    await closed;
    const bytes = Buffer.concat(chunks);
    return isUtf8(bytes) && !bytes.includes(0) ? bytes.toString('utf8') : null;
  } finally {
    signal.removeEventListener('abort', abort);
    stream.destroy();
  }
}
export class ProjectFiles {
  /**
   * 入口 / Entry: ProjectFiles.constructor.
   * 功能：建立 ProjectFiles 的扫描项目文件与搜索结果上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectFiles context for this module's responsibility: Scans project files and search matches under input limits and cancellation. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private workspaces: WorkspacesV1,
  ) {}
  /**
   * 入口 / Entry: ProjectFiles.scan.
   * 功能：在客户机项目目录内有界遍历普通文件，可读取文本生成搜索匹配。
   * Purpose: Traverses bounded regular files in the guest project and optionally reads text search matches.
   * 设计：目录范围、节点与字节限制共同防止无限扫描；取消关闭原 SFTP，超限结果明确截断而不越界读取。
   * Design: Path/node/byte bounds prevent unbounded traversal; cancellation closes original SFTP and truncation does not authorize out-of-scope reads.
   * 输入 / Inputs: id: string; query: default=''; content: default=false; signal: AbortSignal optional
   * 输出 / Returns: `this.machines.sftp( id, async (ftp, transport) => { const active = transport ? AbortSignal.any([timeout, transport]) : timeou…`.
   * 副作用 / Effects: `AbortSignal.any`; `AbortSignal.timeout`.
   * 拒绝 / Refusals: 条件 / conditions `query.length > 200`; `content && !query.trim()`; 异常 / errors `new AppError('搜索词最多 200 个字符')`; `new AppError('请输入搜索内容')`.
   */
  async scan(id: string, query = '', content = false, signal?: AbortSignal) {
    if (query.length > 200) throw new AppError('搜索词最多 200 个字符');
    if (content && !query.trim()) throw new AppError('请输入搜索内容');
    const project = await this.workspaces.config(id);
    const timeout = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30000)]);
    /**
     * 入口 / Entry: ProjectFiles.scan.callback@59.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
     * 输入 / Inputs: ftp; transport
     * 输出 / Returns: `{ root: project.directory, files: files.slice(0, 2000), matches, scanned, truncated: truncated || pending.length > 0 || files…`.
     * 副作用 / Effects: `AbortSignal.any`; `pending.shift`; `pending.push`; `files.push`; `matches.push`; 更新 / updates `truncated`, `readBytes`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.machines.sftp(
      id,
      async (ftp, transport) => {
        const active = transport ? AbortSignal.any([timeout, transport]) : timeout;
        const files: ProjectFile[] = [],
          matches: SearchMatch[] = [],
          pending = [{ path: '', depth: 0 }];
        let scanned = 0,
          readBytes = 0,
          truncated = false;
        const needle = query.toLocaleLowerCase();
        while (pending.length && scanned < 4000 && matches.length < 200) {
          active.throwIfAborted();
          const dir = pending.shift()!;
          const children = await new Promise<FileEntry[]>((resolve, reject) =>
            ftp.readdir(posix.join(project.directory, dir.path), (error, entries) =>
              error ? reject(error) : resolve(entries),
            ),
          );
          children.sort(
            (a, b) =>
              Number(kind(b) === 0x4000) - Number(kind(a) === 0x4000) || a.filename.localeCompare(b.filename),
          );
          for (const child of children) {
            active.throwIfAborted();
            if (
              ['.', '..'].includes(child.filename) ||
              excluded.has(child.filename) ||
              /[\x00-\x1f/]/.test(child.filename) ||
              kind(child) === 0xa000
            )
              continue;
            if (++scanned > 4000 || matches.length >= 200) {
              truncated = true;
              break;
            }
            const path = dir.path ? `${dir.path}/${child.filename}` : child.filename;
            if (kind(child) === 0x4000) {
              if (dir.depth < 20) pending.push({ path, depth: dir.depth + 1 });
              else truncated = true;
              if (!query && !content) files.push({ path, directory: true, size: 0 });
            } else if (kind(child) === 0x8000) {
              if (!content && path.toLocaleLowerCase().includes(needle))
                files.push({ path, directory: false, size: child.attrs.size });
              if (content && child.attrs.size <= 1024 * 1024) {
                if (readBytes + child.attrs.size > 32 * 1024 * 1024) {
                  truncated = true;
                  continue;
                }
                readBytes += child.attrs.size;
                const text = await textFile(ftp, posix.join(project.directory, path), active);
                if (text !== null)
                  for (const [index, line] of text.split('\n').entries()) {
                    if (line.toLocaleLowerCase().includes(needle))
                      matches.push({ path, line: index + 1, text: line.slice(0, 400) });
                    if (matches.length >= 200) {
                      truncated = true;
                      break;
                    }
                  }
              }
            }
          }
        }
        return {
          root: project.directory,
          files: files.slice(0, 2000),
          matches,
          scanned,
          truncated: truncated || pending.length > 0 || files.length > 2000,
        };
      },
      timeout,
    );
  }
}
