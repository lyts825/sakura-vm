import { posix } from 'node:path';
import { isUtf8 } from 'node:buffer';
import type { FileEntry, SFTPWrapper } from 'ssh2';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { AppError } from './model.ts';

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
const kind = (entry: FileEntry) => entry.attrs.mode & 0xf000;
export type ProjectFile = { path: string; directory: boolean; size: number };
export type SearchMatch = { path: string; line: number; text: string };
async function textFile(ftp: SFTPWrapper, path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const stream = ftp.createReadStream(path, { start: 0, end: 1024 * 1024 - 1 });
  const closed = new Promise<void>((resolve) => stream.once('close', resolve));
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
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
  ) {}
  async scan(id: string, query = '', content = false, signal?: AbortSignal) {
    if (query.length > 200) throw new AppError('搜索词最多 200 个字符');
    if (content && !query.trim()) throw new AppError('请输入搜索内容');
    const project = await this.workspaces.config(id);
    const timeout = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30000)]);
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
