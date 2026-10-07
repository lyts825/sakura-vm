/**
 * 模块职责：运行项目语言服务器并应用代码操作，校验文件地址及项目协议流归属。
 * Module purpose: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
 */
import type { FileLocksV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectVersion, type Project } from './project-config.ts';

import { AppError } from '../shared/errors.ts';
import { guestPath } from '../shared/paths.ts';
import { MAX_TEXT_BYTES, textVersion } from './files.ts';
import { quote } from './shell.ts';
import { repositoryPath } from './git-workbench.ts';
import { LspTransport } from './lsp-transport.ts';
import { ProjectProtocolStreams, type ProjectProtocolCapture } from './project-protocol-stream.ts';
import { projectProtocolInstallScript, projectProtocolInstalledCommand } from './project-protocol-assets.ts';
import { guestTask } from './guest-task.ts';
import {
  applyTextEdits,
  positionOffset,
  type LspPosition,
  type LspRange,
  type LspTextEdit,
} from '../shared/language-service.ts';

const prefix = '/opt/sakura-language-services';
type Kind = 'typescript' | 'python';
type Preview = { vm: string; directory: string; capture: ProjectProtocolCapture; expires: number; changes: { path: string; before: string; after: string; version: string }[] };
/**
 * 入口 / Entry: uri.
 * 功能：在运行项目语言服务器并应用代码操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``file://${path.split('/').map(encodeURIComponent).join('/')}`` 供上层消费（`language-services.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `language-services.ts`; this entry produces ``file://${path.split('/').map(encodeURIComponent).join('/')}`` for its caller. Module context: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
 * 处理：通过 `path.split().map().join`, `path.split().map`, `path.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `path.split().map().join`, `path.split().map`, `path.split`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: path: string
 * 输出 / Returns: ``file://${path.split('/').map(encodeURIComponent).join('/')}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const uri = (path: string) => `file://${path.split('/').map(encodeURIComponent).join('/')}`;
/**
 * 入口 / Entry: fromUri.
 * 功能：在运行项目语言服务器并应用代码操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `guestPath(decodeURIComponent(parsed.pathname))` 供上层消费（`language-services.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `language-services.ts`; this entry produces `guestPath(decodeURIComponent(parsed.pathname))` for its caller. Module context: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
 * 处理：通过 `guestPath`, `decodeURIComponent` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `guestPath`, `decodeURIComponent`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: `guestPath(decodeURIComponent(parsed.pathname))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `typeof value !== 'string'`; `parsed.protocol !== 'file:' || (parsed.hostname && parsed.hostname !== 'localhost') || parsed.search || parsed.hash`; 异常 / errors `new AppError('语言服务器返回了无效的文件地址')`; `new AppError('语言服务器返回了非本地文件地址')`.
 */
function fromUri(value: unknown) {
  if (typeof value !== 'string') throw new AppError('语言服务器返回了无效的文件地址');
  const parsed = new URL(value);
  if (parsed.protocol !== 'file:' || (parsed.hostname && parsed.hostname !== 'localhost') || parsed.search || parsed.hash)
    throw new AppError('语言服务器返回了非本地文件地址');
  return guestPath(decodeURIComponent(parsed.pathname));
}
/**
 * 入口 / Entry: language.
 * 功能：在运行项目语言服务器并应用代码操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ kind: 'typescript', id, executable: 'typescript-language-server' }` / `{ kind: 'python', id: 'python', executable: 'pyright-langserver' }` 供上层消费（`language-services.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `language-services.ts`; this entry produces `{ kind: 'typescript', id, executable: 'typescript-language-server' }` / `{ kind: 'python', id: 'python', executable: 'pyright-langserver' }` for its caller. Module context: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
 * 处理：通过 `posix.extname().toLowerCase`, `posix.extname`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `posix.extname().toLowerCase`, `posix.extname`, `inline.includes`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)`; `ext === '.py'`.
 * 输入 / Inputs: path: string
 * 输出 / Returns: { kind: Kind; id: string; executable: string }；结果来自 / values from `{ kind: 'typescript', id, executable: 'typescript-language-server' }`; `{ kind: 'python', id: 'python', executable: 'pyright-langserver' }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 异常 / errors `new AppError('当前语言服务支持 TypeScript、JavaScript 和 Python 文件', 400)`.
 */
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
/**
 * 入口 / Entry: projectFile.
 * 功能：在运行项目语言服务器并应用代码操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `absolute` 供上层消费（`language-services.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `language-services.ts`; this entry produces `absolute` for its caller. Module context: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
 * 处理：通过 `guestPath`, `posix.relative`, `repositoryPath.parse`, `relative.startsWith` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `guestPath`, `posix.relative`, `repositoryPath.parse`, `relative.startsWith`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: directory: string; input: string
 * 输出 / Returns: `absolute`.
 * 副作用 / Effects: `relative.startsWith`.
 * 拒绝 / Refusals: 条件 / conditions `relative === '.' || relative.startsWith('../') || posix.isAbsolute(relative)`; 异常 / errors `new AppError('文件必须位于当前项目目录内')`.
 */
function projectFile(directory: string, input: string) {
  const absolute = guestPath(input);
  const relative = posix.relative(directory, absolute);
  repositoryPath.parse(relative);
  if (relative === '.' || relative.startsWith('../') || posix.isAbsolute(relative))
    throw new AppError('文件必须位于当前项目目录内');
  return absolute;
}
/**
 * 入口 / Entry: textEdits.
 * 功能：在运行项目语言服务器并应用代码操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value.map((item) => { if (!item || typeof item.newText !== 'string' || !item.range?.start || !item.range?.end || item.newText…` 供上层消费（`language-services.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `language-services.ts`; this entry produces `value.map((item) => { if (!item || typeof item.newText !== 'string' || !item.range?.start || !item.range?.end || item.newText…` for its caller. Module context: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
 * 处理：通过 `value.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `value.map`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: LspTextEdit[]；结果来自 / values from `value.map((item) => { if (!item || typeof item.newText !== 'string' || !item.range?.start || !item.range?.end || item.newText…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!Array.isArray(value) || value.length > 1000`; 异常 / errors `new AppError('语言服务器返回的编辑数量无效')`.
 */
function textEdits(value: unknown): LspTextEdit[] {
  if (!Array.isArray(value) || value.length > 1000) throw new AppError('语言服务器返回的编辑数量无效');
  return value.map((item) => {
    if (!item || typeof item.newText !== 'string' || !item.range?.start || !item.range?.end ||
        item.newText.length > MAX_TEXT_BYTES) throw new AppError('语言服务器返回了无效的文本编辑');
    return { range: item.range as LspRange, newText: item.newText };
  });
}
/**
 * 入口 / Entry: workspaceEdits.
 * 功能：在运行项目语言服务器并应用代码操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `entries` 供上层消费（`language-services.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `language-services.ts`; this entry produces `entries` for its caller. Module context: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
 * 处理：通过 `entries.push`, `textEdits` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `entries.push`, `textEdits`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: any
 * 输出 / Returns: `entries`.
 * 副作用 / Effects: `entries.push`.
 * 拒绝 / Refusals: 条件 / conditions `!value || typeof value !== 'object'`; `value.changes`; `typeof value.changes !== 'object' || Array.isArray(value.changes)`; 异常 / errors `new AppError('语言服务器没有提供重命名修改')`; `new AppError('重命名修改格式无效')`.
 */
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
  /**
   * 入口 / Entry: LanguageServices.constructor.
   * 功能：建立 LanguageServices 的运行项目语言服务器并应用代码操作上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the LanguageServices context for this module's responsibility: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; locks: FileLocksV1; options: { streams?: LanguageServices['streams']; adminTask?: typeof guestTask } default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.streams`.
   */
  constructor(private machines: Machines, private workspaces: WorkspacesV1, private locks: FileLocksV1,
    private options: { streams?: LanguageServices['streams']; adminTask?: typeof guestTask } = {}) {
    this.streams = options.streams || new ProjectProtocolStreams(machines, workspaces);
  }
  /**
   * 入口 / Entry: LanguageServices.status.
   * 功能：在运行项目语言服务器并应用代码操作中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ language: lang.id, installed, supported: true, pending }` 供上层消费（`LanguageServices`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `LanguageServices`; this entry produces `{ language: lang.id, installed, supported: true, pending }` for its caller. Module context: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
   * 处理：通过 `this.workspaces.config`, `projectFile`, `language`, `this.machines.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.config`, `projectFile`, `language`, `this.machines.exec`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; path: string; signal: AbortSignal optional
   * 输出 / Returns: `{ language: lang.id, installed, supported: true, pending }`.
   * 副作用 / Effects: `this.machines.exec`; `pending.push`; 更新 / updates `path`, `installed`, `needsReview`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `needsReview = true;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `needsReview = true;`; these statements determine whether a failure is absorbed or rejected again.
   */
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
  /**
   * 入口 / Entry: LanguageServices.install.
   * 功能：在运行项目语言服务器并应用代码操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ installed: true, languages: ['TypeScript', 'JavaScript', 'Python'] }` 供上层消费（`LanguageServices`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LanguageServices`; this entry produces `{ installed: true, languages: ['TypeScript', 'JavaScript', 'Python'] }` for its caller. Module context: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
   * 处理：通过 `inline`, `projectProtocolInstallScript`, `this.machines.get`, `inline.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline`, `projectProtocolInstallScript`, `this.machines.get`, `inline.slice`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `{ installed: true, languages: ['TypeScript', 'JavaScript', 'Python'] }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError(`语言服务安装失败：${(result.stderr || result.stdout).slice(-2000)}`, 502)`.
   */
  async install(id: string, signal?: AbortSignal) {
    const result = await (this.options.adminTask || guestTask)(this.machines, id,
      projectProtocolInstallScript('lsp', this.machines.get(id).distro || 'alpine'), signal || new AbortController().signal,
      undefined, 360000);
    if (result.code !== 0) throw new AppError(`语言服务安装失败：${(result.stderr || result.stdout).slice(-2000)}`, 502);
    return { installed: true, languages: ['TypeScript', 'JavaScript', 'Python'] };
  }

  /**
   * 入口 / Entry: LanguageServices.session.
   * 功能：在运行项目语言服务器并应用代码操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`LanguageServices`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LanguageServices`; this entry produces `result` for its caller. Module context: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
   * 处理：通过 `projectFile`, `language`, `AbortSignal.timeout`, `AbortSignal.any` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectFile`, `language`, `AbortSignal.timeout`, `AbortSignal.any`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; project: Project; path: string; content: string; signal: AbortSignal | undefined; action: (connection: LspTransport, address: string, diagnostics: { items: any[] | null; updat…; timeoutMs: number; expectedLive: object
   * 输出 / Returns: Promise<T>；结果来自 / values from `result`.
   * 副作用 / Effects: `AbortSignal.timeout`; `AbortSignal.any`; `connection.onNotification`; `connection.request`; `connection.notify`; 更新 / updates `path`, `connection`.
   * 拒绝 / Refusals: 条件 / conditions `Buffer.byteLength(content) > MAX_TEXT_BYTES`; 异常 / errors `new AppError('文本超过 1 MiB', 413)`.
   * 收尾：退出 try 区域时始终执行 `connection?.close();`; `await owner.close();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `connection?.close();`; `await owner.close();`; these steps also apply to exceptional exits.
   */
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
  /**
   * 签名 / Signature: LanguageServices.execute.
   * 功能：为运行项目语言服务器并应用代码操作声明 execute 的输入与结果契约，所属容器为 LanguageServices。
   * Purpose: Declares the input/result contract for execute in LanguageServices. Module responsibility: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
   * 输入 / Inputs: id: string; input: { action: 'completion'; path: string; content: string; position: LspPosition }; signal: AbortSignal optional
   * 输出 / Returns: Promise<{ path: string; items: { label: string; detail: string; insertText: string; range: LspRange | null }[] }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  execute(id: string, input: { action: 'completion'; path: string; content: string; position: LspPosition }, signal?: AbortSignal): Promise<{ path: string; items: { label: string; detail: string; insertText: string; range: LspRange | null }[] }>;
  /**
   * 签名 / Signature: LanguageServices.execute.
   * 功能：为运行项目语言服务器并应用代码操作声明 execute 的输入与结果契约，所属容器为 LanguageServices。
   * Purpose: Declares the input/result contract for execute in LanguageServices. Module responsibility: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
   * 输入 / Inputs: id: string; input: { action: 'definition'; path: string; content: string; position: LspPosition }; signal: AbortSignal optional
   * 输出 / Returns: Promise<{ path: string; locations: { path: string; line: number; column: number }[] }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  execute(id: string, input: { action: 'definition'; path: string; content: string; position: LspPosition }, signal?: AbortSignal): Promise<{ path: string; locations: { path: string; line: number; column: number }[] }>;
  /**
   * 签名 / Signature: LanguageServices.execute.
   * 功能：为运行项目语言服务器并应用代码操作声明 execute 的输入与结果契约，所属容器为 LanguageServices。
   * Purpose: Declares the input/result contract for execute in LanguageServices. Module responsibility: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
   * 输入 / Inputs: id: string; input: { action: 'diagnostics'; path: string; content: string }; signal: AbortSignal optional
   * 输出 / Returns: Promise<{ path: string; received: boolean; diagnostics: { severity: string; message: string; line: number; column: number }[] }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  execute(id: string, input: { action: 'diagnostics'; path: string; content: string }, signal?: AbortSignal): Promise<{ path: string; received: boolean; diagnostics: { severity: string; message: string; line: number; column: number }[] }>;
  /**
   * 签名 / Signature: LanguageServices.execute.
   * 功能：为运行项目语言服务器并应用代码操作声明 execute 的输入与结果契约，所属容器为 LanguageServices。
   * Purpose: Declares the input/result contract for execute in LanguageServices. Module responsibility: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
   * 输入 / Inputs: id: string; input: { action: 'rename'; path: string; content: string; position: LspPosition; newName: st…; signal: AbortSignal optional
   * 输出 / Returns: Promise<{ token: string; files: { path: string; before: string; after: string }[] }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  execute(id: string, input: { action: 'rename'; path: string; content: string; position: LspPosition; newName: string; version: string }, signal?: AbortSignal): Promise<{ token: string; files: { path: string; before: string; after: string }[] }>;
  /**
   * 签名 / Signature: LanguageServices.execute.
   * 功能：为运行项目语言服务器并应用代码操作声明 execute 的输入与结果契约，所属容器为 LanguageServices。
   * Purpose: Declares the input/result contract for execute in LanguageServices. Module responsibility: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
   * 输入 / Inputs: id: string; input: { action: 'completion' | 'definition' | 'diagnostics' | 'rename'; path: string; conte…; signal: AbortSignal optional
   * 输出 / Returns: Promise<any>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  execute(id: string, input: { action: 'completion' | 'definition' | 'diagnostics' | 'rename'; path: string; content: string; position?: LspPosition; newName?: string; version?: string }, signal?: AbortSignal): Promise<any>;
  /**
   * 入口 / Entry: LanguageServices.execute.
   * 功能：在运行项目语言服务器并应用代码操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.workspaces.projects.inScope(id, projectId, () => this.executeCaptured(id, copied, signal, projectId, live))` 供上层消费（`LanguageServices`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LanguageServices`; this entry produces `this.workspaces.projects.inScope(id, projectId, () => this.executeCaptured(id, copied, signal, projectId, live))` for its caller. Module context: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
   * 处理：通过 `this.workspaces.projects.current`, `this.machines.live.get`, `structuredClone`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.projects.current`, `this.machines.live.get`, `structuredClone`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: { action: 'completion' | 'definition' | 'diagnostics' | 'rename'; path: string; conte…; signal: AbortSignal optional
   * 输出 / Returns: Promise<any>；结果来自 / values from `this.workspaces.projects.inScope(id, projectId, () => this.executeCaptured(id, copied, signal, projectId, live))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!live || this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('原客户机运行身份不可用', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   */
  async execute(id: string, input: {
    action: 'completion' | 'definition' | 'diagnostics' | 'rename';
    path: string; content: string; position?: LspPosition; newName?: string; version?: string;
  }, signal?: AbortSignal): Promise<any> {
    const projectId = this.workspaces.projects.current(id), live = this.machines.live.get(id), copied = structuredClone(input);
    if (!live || this.machines.state(id) !== 'running') throw new AppError('原客户机运行身份不可用', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    return this.workspaces.projects.inScope(id, projectId, () => this.executeCaptured(id, copied, signal, projectId, live));
  }
  /**
   * 入口 / Entry: LanguageServices.executeCaptured.
   * 功能：在固定项目配置和客户机身份下打开语言协议流并执行 LSP 查询或代码动作。
   * Purpose: Opens project language streams and performs LSP queries/code actions against captured configuration/guest identity.
   * 设计：文件 URI 限制到项目路径；准备后和结果前重新核对归属，失去原协议时不自动接管其他同名运行。
   * Design: File URIs stay project-bound and identity is rechecked after preparation/before results; a lost protocol does not authorize adoption of another run.
   * 输入 / Inputs: id: string; input: { action: 'completion' | 'definition' | 'diagnostics' | 'rename'; path: string; conte…; signal: AbortSignal | undefined; projectId: string; live: object
   * 输出 / Returns: Promise<any>；结果来自 / values from `this.session(id, project, path, input.content, signal, async (connection, address, diagnostics, activeSignal, capture) => { i…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `(raw._workspace || 'default') !== projectId`; `Buffer.byteLength(input.content) > MAX_TEXT_BYTES`; `input.action !== 'diagnostics'`; 异常 / errors `new AppError('原项目配置归属不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`; `new AppError('文本超过 1 MiB', 413)`.
   */
  private async executeCaptured(id: string, input: {
    action: 'completion' | 'definition' | 'diagnostics' | 'rename';
    path: string; content: string; position?: LspPosition; newName?: string; version?: string;
  }, signal: AbortSignal | undefined, projectId: string, live: object): Promise<any> {
    /**
     * 入口 / Entry: LanguageServices.executeCaptured.current.
     * 功能：在运行项目语言服务器并应用代码操作中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`LanguageServices`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `LanguageServices`; the calls and state transitions below complete the operation. Module context: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
     * 处理：通过 `signal.throwIfAborted`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.machines.state`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.workspaces.projects.current(id) !== projectId || this.machines.live.get(id) !== live || this.machines.state(id) !== 'run…`; 异常 / errors `new AppError('原项目或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
     */
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
    /**
     * 入口 / Entry: LanguageServices.executeCaptured.callback@202.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.session）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.session).
     * 输入 / Inputs: connection; address; diagnostics; activeSignal; capture
     * 输出 / Returns: `{ path, received: !!reported, diagnostics: (reported || []).map((item: any) => ({ severity: item.severity === 2 ? 'warning' :…`; `{ path, items: items.slice(0, 100).map((item: any) => ({ label: String(item.label || '').slice(0, 200), detail: String(item.d…`; `{ path, locations: locations.slice(0, 30).map((item: any) => { const target = projectFile(project.directory, fromUri(item.tar…`；另有分支返回 / additional branch-specific returns.
     * 副作用 / Effects: `connection.request`; `grouped.set`; `changes.push`; `this.previews.delete`; `this.previews.set`.
     * 拒绝 / Refusals: 条件 / conditions `Buffer.byteLength(after) > MAX_TEXT_BYTES`; `!changes.length`; `changes.reduce((bytes, item) => bytes + Buffer.byteLength(item.before) + Buffer.byteLength(item.after), 0) > 4 * MAX_TEXT_BYT…`; 异常 / errors `new AppError('重命名后的文件超过 1 MiB', 413)`; `new AppError('语言服务器未生成可应用的重命名修改')`.
     */
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
        /**
         * 入口 / Entry: LanguageServices.executeCaptured.callback@244.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（locations.slice().map）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (locations.slice().map).
         * 输入 / Inputs: item: any
         * 输出 / Returns: `{ path: target, line: start.line + 1, column: (start.character || 0) + 1 }`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 拒绝 / Refusals: 条件 / conditions `!start || !Number.isInteger(start.line) || start.line < 0`; 异常 / errors `new AppError('定义位置无效')`.
         */
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
  /**
   * 入口 / Entry: LanguageServices.apply.
   * 功能：在运行项目语言服务器并应用代码操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.locks.withMutation(id, preview.changes.map((item) => item.path), lockToken, async () => { for (const change of preview.c…` 供上层消费（`LanguageServices`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LanguageServices`; this entry produces `this.locks.withMutation(id, preview.changes.map((item) => item.path), lockToken, async () => { for (const change of preview.c…` for its caller. Module context: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
   * 处理：通过 `this.previews.get`, `this.workspaces.config`, `this.workspaces.projects.current`, `projectVersion` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.previews.get`, `this.workspaces.config`, `this.workspaces.projects.current`, `projectVersion`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; token: string; lockToken: string optional
   * 输出 / Returns: `this.locks.withMutation(id, preview.changes.map((item) => item.path), lockToken, async () => { for (const change of preview.c…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!preview || preview.vm !== id || preview.expires < Date.now()`; `this.workspaces.projects.current(id) !== preview.capture.projectId || (project._workspace || 'default') !== preview.capture.p…`; 异常 / errors `new AppError('重命名预览已过期，请重新生成', 409)`; `new AppError('当前项目已切换或配置改变，请重新生成重命名预览', 409)`.
   */
  async apply(id: string, token: string, lockToken?: string) {
    const preview = this.previews.get(token);
    if (!preview || preview.vm !== id || preview.expires < Date.now()) throw new AppError('重命名预览已过期，请重新生成', 409);
    const project = await this.workspaces.config(id);
    if (this.workspaces.projects.current(id) !== preview.capture.projectId || (project._workspace || 'default') !== preview.capture.projectId ||
        project.directory !== preview.directory || projectVersion(project) !== preview.capture.configSha256)
      throw new AppError('当前项目已切换或配置改变，请重新生成重命名预览', 409);
    await this.streams.assertCapture(id, preview.capture);
    /**
     * 入口 / Entry: LanguageServices.apply.callback@282.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.locks.withMutation）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.locks.withMutation).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ files: preview.changes.map(({ path, after }) => ({ path, content: after, version: textVersion(after) })) }`.
     * 副作用 / Effects: `this.previews.delete`; `this.machines.writeGuestFile`; `written.push`; `failed.push`.
     * 拒绝 / Refusals: 条件 / conditions `textVersion(current) !== change.version`; 异常 / errors `new AppError(`文件已改变，请重新生成预览：${change.path}`, 409)`; `new AppError(failed.length ? `重命名失败且以下文件未能回滚：${failed.join('、')}；${(error as Error).message}` : `重命名失败，已回滚：${(error as Error)…`.
     * 失败处理：catch 分支执行 `const failed: string[] = [];`; `for (const change of written.reverse()) { try { await this.machines.writeGuestFile(id, change.path, change.before, true, text…`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `const failed: string[] = [];`; `for (const change of written.reverse()) { try { await this.machines.writeGuestFile(id, change.path, change.before, true, text…`; these statements determine whether a failure is absorbed or rejected again.
     */
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
  /**
   * 入口 / Entry: LanguageServices.close.
   * 功能：在运行项目语言服务器并应用代码操作中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`LanguageServices`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `LanguageServices`; the calls and state transitions below complete the operation. Module context: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
   * 处理：通过 `this.streams.close`, `this.previews.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.streams.close`, `this.previews.clear`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.streams.close`; `this.previews.clear`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() { await this.streams.close(); this.previews.clear(); }
  /**
   * 入口 / Entry: LanguageServices.stop.
   * 功能：在运行项目语言服务器并应用代码操作中，结束、撤销或清理本次拥有的领域资源；本入口产生 `{ stopped: true }` 供上层消费（`LanguageServices`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `LanguageServices`; this entry produces `{ stopped: true }` for its caller. Module context: Runs project language servers and code actions, checking file URLs and original protocol-stream ownership.
   * 处理：通过 `inline.find`, `this.streams.recordsAll`, `this.streams.stop` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.find`, `this.streams.recordsAll`, `this.streams.stop`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; token: string
   * 输出 / Returns: `{ stopped: true }`.
   * 副作用 / Effects: `this.streams.stop`.
   * 拒绝 / Refusals: 条件 / conditions `!record`; 异常 / errors `new AppError('原语言协议运行票据不存在或已经核销', 409, 'PROJECT_IDENTITY_RUN_STALE')`.
   */
  async stop(id: string, token: string) {
    const record = (await this.streams.recordsAll(id)).find(row => row.kind === 'lsp' && row.runId === token);
    if (!record) throw new AppError('原语言协议运行票据不存在或已经核销', 409, 'PROJECT_IDENTITY_RUN_STALE');
    await this.streams.stop(id, record.projectId, token); return { stopped: true };
  }

}
