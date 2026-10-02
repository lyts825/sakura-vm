import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type { Machines } from './machines.ts';
import { projectVersion, type Workspaces, type Project } from './workspaces.ts';
import type { FileLocks } from './file-locks.ts';
import { AppError, guestPath } from './model.ts';
import { MAX_TEXT_BYTES, quote, textVersion } from './files.ts';
import { repositoryPath } from './git-workbench.ts';
import { LspTransport } from './lsp-transport.ts';
import { ProjectProtocolStreams, type ProjectProtocolCapture } from './project-protocol-stream.ts';
import { projectProtocolInstallScript, projectProtocolInstalledCommand } from './project-protocol-assets.ts';
import { guestTask } from './guest-task.ts';
import { applyTextEdits, positionOffset, type LspPosition, type LspRange, type LspTextEdit } from '../shared/language-service.ts';

const prefix = '/opt/sakura-language-services';
type Kind = 'typescript' | 'python';
type Preview = { vm: string; directory: string; capture: ProjectProtocolCapture; expires: number; changes: { path: string; before: string; after: string; version: string }[] };
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
  private streams: Pick<ProjectProtocolStreams, 'open' | 'assertCapture' | 'recordsAll' | 'readonly' | 'recover' | 'stop' | 'close'>;
  constructor(private machines: Machines, private workspaces: Workspaces, private locks: FileLocks,
    private options: { streams?: LanguageServices['streams']; adminTask?: typeof guestTask } = {}) {
    this.streams = options.streams || new ProjectProtocolStreams(machines, workspaces);
  }
  async status(id: string, path: string, signal?: AbortSignal) {
    const project = await this.workspaces.config(id);
    path = projectFile(project.directory, path);
    const lang = language(path);
    const result = await this.machines.exec(id, projectProtocolInstalledCommand('lsp'), 10000, signal);
    let installed = false;
    try { installed = result.code === 0 && JSON.parse(result.stdout).installed === true; } catch {}
    const pending = [];
    for (const record of (await this.streams.recordsAll(id)).filter(row => row.kind === 'lsp' && row.projectId === (project._workspace || 'default'))) {
      let needsReview = record.phase !== 'active';
      try { await this.streams.readonly(record, signal); } catch { needsReview = true; }
      pending.push({ token: record.runId, phase: record.phase, needsReview });
    }
    return { language: lang.id, installed, supported: true, pending };
  }
  async install(id: string, signal?: AbortSignal) {
    const result = await (this.options.adminTask || guestTask)(this.machines, id,
      projectProtocolInstallScript('lsp', this.machines.get(id).distro || 'alpine'), signal || new AbortController().signal,
      undefined, 360000);
    if (result.code !== 0) throw new AppError(`语言服务安装失败：${(result.stderr || result.stdout).slice(-2000)}`, 502);
    return { installed: true, languages: ['TypeScript', 'JavaScript', 'Python'] };
  }

  private async session<T>(id: string, project: Project, path: string, content: string, signal: AbortSignal | undefined,
    action: (connection: LspTransport, address: string,
      diagnostics: { items: any[] | null; updatedAt: number }, activeSignal: AbortSignal, capture: ProjectProtocolCapture) => Promise<T>,
    timeoutMs: number, expectedLive: object): Promise<T> {
    path = projectFile(project.directory, path);
    if (Buffer.byteLength(content) > MAX_TEXT_BYTES) throw new AppError('文本超过 1 MiB', 413);
    const lang = language(path);
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const executable = `${prefix}/node_modules/.bin/${lang.executable}`;
    const command = `if test -x ${quote(executable)}; then exec ${quote(executable)} --stdio; else echo '请先安装语言服务' >&2; exit 127; fi`;
    const owner = await this.streams.open(id, 'lsp', project, () => ({ command }), combined, timeoutMs + 30000, expectedLive);
    let connection: LspTransport | undefined;
    try {
      connection = new LspTransport(owner.stream);
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
      await owner.assertCurrent(); await owner.assertNative();
      const result = await action(connection, address, diagnostics, combined, owner.capture);
      await owner.assertCurrent(); await owner.assertNative(); return result;
    } finally {
      connection?.close();
      await owner.close();
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
    const projectId = this.workspaces.projects.current(id), live = this.machines.live.get(id), copied = structuredClone(input);
    if (!live || this.machines.state(id) !== 'running') throw new AppError('原客户机运行身份不可用', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    return this.workspaces.projects.inScope(id, projectId, () => this.executeCaptured(id, copied, signal, projectId, live));
  }
  private async executeCaptured(id: string, input: {
    action: 'completion' | 'definition' | 'diagnostics' | 'rename';
    path: string; content: string; position?: LspPosition; newName?: string; version?: string;
  }, signal: AbortSignal | undefined, projectId: string, live: object): Promise<any> {
    const current = () => { signal?.throwIfAborted();
      if (this.workspaces.projects.current(id) !== projectId || this.machines.live.get(id) !== live || this.machines.state(id) !== 'running')
        throw new AppError('原项目或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED'); };
    current();
    const raw = await this.workspaces.config(id);
    current(); if ((raw._workspace || 'default') !== projectId) throw new AppError('原项目配置归属不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    const project = Object.defineProperty(structuredClone(raw), '_workspace', { value: raw._workspace, enumerable: false });
    const path = projectFile(project.directory, input.path);
    const lang = language(path);
    if (Buffer.byteLength(input.content) > MAX_TEXT_BYTES) throw new AppError('文本超过 1 MiB', 413);
    if (input.action !== 'diagnostics') {
      if (!input.position) throw new AppError('需要光标位置');
      positionOffset(input.content, input.position);
    }
    if (input.action === 'rename') {
      if (!input.newName || input.newName.length > 128 || /[\x00-\x1f]/.test(input.newName))
        throw new AppError('需要有效的新名称');
      if (!input.version || !/^[a-f0-9]{64}$/.test(input.version) || textVersion(input.content) !== input.version)
        throw new AppError('请先保存文件再重命名', 409);
      const content = await this.machines.readGuestFile(id, path); current();
      if (textVersion(content) !== input.version) throw new AppError('文件已被修改，请刷新后重试', 409);
    }
    await this.streams.recover(id, projectId, 'lsp', signal); current();
    const timeoutMs = input.action === 'diagnostics' || input.action === 'rename' ? 120000 : 30000;
    return this.session(id, project, path, input.content, signal, async (connection, address, diagnostics, activeSignal, capture) => {
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
      this.previews.set(token, { vm: id, directory: project.directory, capture: { ...capture, signal: new AbortController().signal }, expires: Date.now() + 5 * 60_000, changes });
      return { token, files: changes.map(({ path, before, after }) => ({ path, before, after })) };
    }, timeoutMs, live);
  }
  async apply(id: string, token: string, lockToken?: string) {
    const preview = this.previews.get(token);
    if (!preview || preview.vm !== id || preview.expires < Date.now()) throw new AppError('重命名预览已过期，请重新生成', 409);
    const project = await this.workspaces.config(id);
    if (this.workspaces.projects.current(id) !== preview.capture.projectId || (project._workspace || 'default') !== preview.capture.projectId ||
        project.directory !== preview.directory || projectVersion(project) !== preview.capture.configSha256)
      throw new AppError('当前项目已切换或配置改变，请重新生成重命名预览', 409);
    await this.streams.assertCapture(id, preview.capture);
    return this.locks.withMutation(id, preview.changes.map((item) => item.path), lockToken, async () => {
      for (const change of preview.changes) {
        await this.streams.assertCapture(id, preview.capture);
        const current = await this.machines.readGuestFile(id, change.path);
        if (textVersion(current) !== change.version) throw new AppError(`文件已改变，请重新生成预览：${change.path}`, 409);
      }
      this.previews.delete(token);
      const written: typeof preview.changes = [];
      try {
        for (const change of preview.changes) {
          await this.streams.assertCapture(id, preview.capture);
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
  async close() { await this.streams.close(); this.previews.clear(); }
  async stop(id: string, token: string) {
    const record = (await this.streams.recordsAll(id)).find(row => row.kind === 'lsp' && row.runId === token);
    if (!record) throw new AppError('原语言协议运行票据不存在或已经核销', 409, 'PROJECT_IDENTITY_RUN_STALE');
    await this.streams.stop(id, record.projectId, token); return { stopped: true };
  }

}
