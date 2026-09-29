import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type { Duplex } from 'node:stream';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import type { FileLocks } from './file-locks.ts';
import { AppError, guestPath } from './model.ts';
import { MAX_TEXT_BYTES, quote, textVersion } from './files.ts';
import { repositoryPath } from './git-workbench.ts';
import { LspTransport } from './lsp-transport.ts';
import { projectNetworkCommand } from './project-network-isolation.ts';
import { applyTextEdits, positionOffset, type LspPosition, type LspRange, type LspTextEdit } from '../shared/language-service.ts';

const prefix = '/opt/sakura-language-services';
type Kind = 'typescript' | 'python';
type Preview = { vm: string; directory: string; expires: number; changes: { path: string; before: string; after: string; version: string }[] };
const uri = (path: string) => `file://${path.split('/').map(encodeURIComponent).join('/')}`;
function fromUri(value: unknown) {
  if (typeof value !== 'string') throw new AppError('语言服务器返回了无效的文件地址');
  const parsed = new URL(value);
  if (parsed.protocol !== 'file:' || (parsed.hostname && parsed.hostname !== 'localhost') || parsed.search || parsed.hash)
    throw new AppError('语言服务器返回了非本地文件地址');
  return guestPath(decodeURIComponent(parsed.pathname));
}
function language(path: string): { kind: Kind; id: string; executable: string } {
  const ext = posix.extname(path).toLowerCase();
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    const id = ({ '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript',
      '.jsx': 'javascriptreact', '.mjs': 'javascript', '.cjs': 'javascript' } as Record<string, string>)[ext];
    return { kind: 'typescript', id, executable: 'typescript-language-server' };
  }
  if (ext === '.py') return { kind: 'python', id: 'python', executable: 'pyright-langserver' };
  throw new AppError('当前语言服务支持 TypeScript、JavaScript 和 Python 文件', 400);
}
function projectFile(directory: string, input: string) {
  const absolute = guestPath(input);
  const relative = posix.relative(directory, absolute);
  repositoryPath.parse(relative);
  if (relative === '.' || relative.startsWith('../') || posix.isAbsolute(relative))
    throw new AppError('文件必须位于当前项目目录内');
  return absolute;
}
function textEdits(value: unknown): LspTextEdit[] {
  if (!Array.isArray(value) || value.length > 1000) throw new AppError('语言服务器返回的编辑数量无效');
  return value.map((item) => {
    if (!item || typeof item.newText !== 'string' || !item.range?.start || !item.range?.end ||
        item.newText.length > MAX_TEXT_BYTES) throw new AppError('语言服务器返回了无效的文本编辑');
    return { range: item.range as LspRange, newText: item.newText };
  });
}
function workspaceEdits(value: any) {
  if (!value || typeof value !== 'object') throw new AppError('语言服务器没有提供重命名修改');
  const entries: { uri: string; edits: LspTextEdit[] }[] = [];
  if (value.changes) {
    if (typeof value.changes !== 'object' || Array.isArray(value.changes)) throw new AppError('重命名修改格式无效');
    for (const [address, edits] of Object.entries(value.changes)) entries.push({ uri: address, edits: textEdits(edits) });
  }
  if (value.documentChanges) {
    if (!Array.isArray(value.documentChanges)) throw new AppError('重命名修改格式无效');
    for (const change of value.documentChanges) {
      if (!change?.textDocument?.uri || !change.edits) throw new AppError('语言服务器返回了不支持的文件操作');
      entries.push({ uri: change.textDocument.uri, edits: textEdits(change.edits) });
    }
  }
  if (!entries.length || entries.length > 20) throw new AppError('重命名涉及的文件数量无效');
  return entries;
}

export class LanguageServices {
  private previews = new Map<string, Preview>();
  constructor(private machines: Machines, private workspaces: Workspaces, private locks: FileLocks) {}
  async status(id: string, path: string, signal?: AbortSignal) {
    const project = await this.workspaces.config(id);
    path = projectFile(project.directory, path);
    const lang = language(path);
    const bundled = `${prefix}/node_modules/.bin/${lang.executable}`;
    const command = lang.kind === 'typescript'
      ? `test -x ${quote(bundled)} && test -f ${quote(`${prefix}/node_modules/typescript/lib/tsserver.js`)}`
      : `test -x ${quote(bundled)} && command -v python3 >/dev/null`;
    const result = await this.machines.exec(id, command, 10000, signal);
    return { language: lang.id, installed: result.code === 0, supported: true };
  }
  async install(id: string, signal?: AbortSignal) {
    const distro = this.machines.get(id).distro;
    const packages = !distro || distro === 'alpine'
      ? 'apk add --no-cache --timeout 30 nodejs npm python3'
      : 'export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y nodejs npm python3';
    const command = `set -eu; if ! command -v npm >/dev/null || ! command -v python3 >/dev/null; then for attempt in 1 2 3; do if (${packages}); then break; fi; sleep 2; done; command -v npm >/dev/null; command -v python3 >/dev/null; fi; for attempt in 1 2 3; do if npm install --prefix ${quote(prefix)} --no-audit --no-fund --omit=dev typescript@5.9.3 typescript-language-server@4.3.4 pyright@1.1.414; then break; fi; sleep 2; done; test -f ${quote(`${prefix}/node_modules/typescript/lib/tsserver.js`)}; test -x ${quote(`${prefix}/node_modules/.bin/typescript-language-server`)}; test -x ${quote(`${prefix}/node_modules/.bin/pyright-langserver`)}`;
    const result = await this.machines.exec(id, command, 360000, signal);
    if (result.code !== 0) throw new AppError(`语言服务安装失败：${(result.stderr || result.stdout).slice(-2000)}`, 502);
    return { installed: true, languages: ['TypeScript', 'JavaScript', 'Python'] };
  }
  private async session<T>(id: string, path: string, content: string, signal: AbortSignal | undefined,
    action: (connection: LspTransport, address: string,
      diagnostics: { items: any[] | null; updatedAt: number }, activeSignal: AbortSignal) => Promise<T>,
    timeoutMs: number): Promise<T> {
    const project = await this.workspaces.config(id);
    path = projectFile(project.directory, path);
    if (Buffer.byteLength(content) > MAX_TEXT_BYTES) throw new AppError('文本超过 1 MiB', 413);
    const lang = language(path);
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const executable = `${prefix}/node_modules/.bin/${lang.executable}`;
    const command = `if test -x ${quote(executable)}; then exec ${quote(executable)} --stdio; else echo '请先安装语言服务' >&2; exit 127; fi`;
    const client = await this.machines.connect(id, 10000, combined);
    let connection: LspTransport | undefined;
    const abort = () => client.destroy();
    combined.addEventListener('abort', abort, { once: true });
    try {
      const stream = await new Promise<Duplex>((resolve, reject) =>
        client.exec(projectNetworkCommand(project, command),
          (error, channel) => error ? reject(error) : resolve(channel)));
      connection = new LspTransport(stream);
      const diagnostics = { items: null as any[] | null, updatedAt: 0 };
      const address = uri(path), rootUri = uri(project.directory);
      connection.onNotification((method, params) => {
        if (method === 'textDocument/publishDiagnostics' && params?.uri === address && Array.isArray(params.diagnostics)) {
          diagnostics.items = params.diagnostics.slice(0, 200);
          diagnostics.updatedAt = Date.now();
        }
      });
      await connection.request('initialize', {
        processId: null, rootUri, workspaceFolders: [{ uri: rootUri, name: posix.basename(project.directory) }],
        initializationOptions: lang.kind === 'typescript'
          ? { disableAutomaticTypingAcquisition: true,
              tsserver: { path: `${prefix}/node_modules/typescript/lib/tsserver.js` } }
          : {},
        capabilities: {
          workspace: { configuration: true, workspaceFolders: true },
          textDocument: {
            synchronization: { didSave: false, willSave: false, dynamicRegistration: false },
            completion: { completionItem: { snippetSupport: false } },
            definition: {}, rename: {}, publishDiagnostics: {},
          },
        },
        clientInfo: { name: 'Sakura', version: '0.1' }, trace: 'off',
      });
      connection.notify('initialized', {});
      connection.notify('textDocument/didOpen', { textDocument: { uri: address, languageId: lang.id, version: 1, text: content } });
      return await action(connection, address, diagnostics, combined);
    } finally {
      combined.removeEventListener('abort', abort);
      connection?.close();
      client.end();
    }
  }
  execute(id: string, input: { action: 'completion'; path: string; content: string; position: LspPosition }, signal?: AbortSignal): Promise<{ path: string; items: { label: string; detail: string; insertText: string; range: LspRange | null }[] }>;
  execute(id: string, input: { action: 'definition'; path: string; content: string; position: LspPosition }, signal?: AbortSignal): Promise<{ path: string; locations: { path: string; line: number; column: number }[] }>;
  execute(id: string, input: { action: 'diagnostics'; path: string; content: string }, signal?: AbortSignal): Promise<{ path: string; received: boolean; diagnostics: { severity: string; message: string; line: number; column: number }[] }>;
  execute(id: string, input: { action: 'rename'; path: string; content: string; position: LspPosition; newName: string; version: string }, signal?: AbortSignal): Promise<{ token: string; files: { path: string; before: string; after: string }[] }>;
  execute(id: string, input: { action: 'completion' | 'definition' | 'diagnostics' | 'rename'; path: string; content: string; position?: LspPosition; newName?: string; version?: string }, signal?: AbortSignal): Promise<any>;
  async execute(id: string, input: {
    action: 'completion' | 'definition' | 'diagnostics' | 'rename';
    path: string; content: string; position?: LspPosition; newName?: string; version?: string;
  }, signal?: AbortSignal): Promise<any> {
    const project = await this.workspaces.config(id);
    const path = projectFile(project.directory, input.path);
    const lang = language(path);
    if (input.action !== 'diagnostics') {
      if (!input.position) throw new AppError('需要光标位置');
      positionOffset(input.content, input.position);
    }
    if (input.action === 'rename') {
      if (!input.newName || input.newName.length > 128 || /[\x00-\x1f]/.test(input.newName))
        throw new AppError('需要有效的新名称');
      if (!input.version || !/^[a-f0-9]{64}$/.test(input.version) || textVersion(input.content) !== input.version)
        throw new AppError('请先保存文件再重命名', 409);
      const current = await this.machines.readGuestFile(id, path);
      if (textVersion(current) !== input.version) throw new AppError('文件已被修改，请刷新后重试', 409);
    }
    const timeoutMs = input.action === 'diagnostics' || input.action === 'rename' ? 120000 : 30000;
    return this.session(id, path, input.content, signal, async (connection, address, diagnostics, activeSignal) => {
      if (lang.kind === 'typescript' && (input.action === 'definition' || input.action === 'rename')) {
        const deadline = Date.now() + (input.action === 'rename' ? 90000 : 3000);
        while (Date.now() < deadline) {
          activeSignal.throwIfAborted();
          const items = diagnostics.items;
          // TypeScript publishes syntax, semantic and suggestion results in separate snapshots.
          if (items && (input.action === 'definition' ||
              Date.now() - diagnostics.updatedAt >= (items.length ? 1000 : 10000))) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (input.action === 'diagnostics') {
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
          activeSignal.throwIfAborted();
          const items = diagnostics.items;
          if (items && (lang.kind === 'python' ||
              Date.now() - diagnostics.updatedAt >= (items.length ? 1000 : 10000))) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const reported = diagnostics.items;
        return { path, received: !!reported, diagnostics: (reported || []).map((item: any) => ({
          severity: item.severity === 2 ? 'warning' : item.severity === 3 ? 'info' : 'error',
          message: String(item.message || '').slice(0, 1000),
          line: Number(item.range?.start?.line ?? 0) + 1,
          column: Number(item.range?.start?.character ?? 0) + 1,
        })) };
      }
      const params = { textDocument: { uri: address }, position: input.position! };
      if (input.action === 'completion') {
        const result = await connection.request('textDocument/completion', params);
        const items = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : [];
        return { path, items: items.slice(0, 100).map((item: any) => ({
          label: String(item.label || '').slice(0, 200), detail: String(item.detail || '').slice(0, 300),
          insertText: item.insertTextFormat === 2 ? String(item.label || '') : String(item.insertText || item.label || ''),
          range: item.textEdit?.range || item.textEdit?.insert || null,
        })) };
      }
      if (input.action === 'definition') {
        const result = await connection.request('textDocument/definition', params);
        const locations = Array.isArray(result) ? result : result ? [result] : [];
        return { path, locations: locations.slice(0, 30).map((item: any) => {
          const target = projectFile(project.directory, fromUri(item.targetUri || item.uri));
          const start = item.targetSelectionRange?.start || item.range?.start;
          if (!start || !Number.isInteger(start.line) || start.line < 0) throw new AppError('定义位置无效');
          return { path: target, line: start.line + 1, column: (start.character || 0) + 1 };
        }) };
      }
      const result = await connection.request('textDocument/rename', { ...params, newName: input.newName });
      const grouped = new Map<string, LspTextEdit[]>();
      for (const entry of workspaceEdits(result)) {
        const target = projectFile(project.directory, fromUri(entry.uri));
        grouped.set(target, [...(grouped.get(target) || []), ...entry.edits]);
      }
      const changes = [];
      for (const [target, edits] of grouped) {
        const before = await this.machines.readGuestFile(id, target);
        const after = applyTextEdits(before, edits);
        if (Buffer.byteLength(after) > MAX_TEXT_BYTES) throw new AppError('重命名后的文件超过 1 MiB', 413);
        if (before !== after) changes.push({ path: target, before, after, version: textVersion(before) });
      }
      if (!changes.length) throw new AppError('语言服务器未生成可应用的重命名修改');
      if (changes.reduce((bytes, item) => bytes + Buffer.byteLength(item.before) + Buffer.byteLength(item.after), 0) > 4 * MAX_TEXT_BYTES)
        throw new AppError('重命名预览超过 4 MiB，请缩小项目范围', 413);
      const token = randomUUID();
      for (const [key, value] of this.previews) if (value.expires < Date.now()) this.previews.delete(key);
      if (this.previews.size >= 8) this.previews.delete(this.previews.keys().next().value!);
      this.previews.set(token, { vm: id, directory: project.directory, expires: Date.now() + 5 * 60_000, changes });
      return { token, files: changes.map(({ path, before, after }) => ({ path, before, after })) };
    }, timeoutMs);
  }
  async apply(id: string, token: string, lockToken?: string) {
    const preview = this.previews.get(token);
    if (!preview || preview.vm !== id || preview.expires < Date.now()) throw new AppError('重命名预览已过期，请重新生成', 409);
    if ((await this.workspaces.config(id)).directory !== preview.directory)
      throw new AppError('当前项目已切换，请重新生成重命名预览', 409);
    return this.locks.withMutation(id, preview.changes.map((item) => item.path), lockToken, async () => {
      for (const change of preview.changes) {
        const current = await this.machines.readGuestFile(id, change.path);
        if (textVersion(current) !== change.version) throw new AppError(`文件已改变，请重新生成预览：${change.path}`, 409);
      }
      this.previews.delete(token);
      const written: typeof preview.changes = [];
      try {
        for (const change of preview.changes) {
          await this.machines.writeGuestFile(id, change.path, change.after, true, change.version);
          written.push(change);
        }
      } catch (error) {
        const failed: string[] = [];
        for (const change of written.reverse()) {
          try { await this.machines.writeGuestFile(id, change.path, change.before, true, textVersion(change.after)); }
          catch { failed.push(change.path); }
        }
        throw new AppError(failed.length
          ? `重命名失败且以下文件未能回滚：${failed.join('、')}；${(error as Error).message}`
          : `重命名失败，已回滚：${(error as Error).message}`, 409);
      }
      return { files: preview.changes.map(({ path, after }) => ({ path, content: after, version: textVersion(after) })) };
    });
  }
}
