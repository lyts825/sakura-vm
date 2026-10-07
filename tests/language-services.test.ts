/**
 * 模块职责：回归验证模块，围绕 `language-services` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `language-services`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: language service installation provisions Python for Pyright diagnostics; private project language server supplies project code and environment only through SESSION2 frame.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Duplex, PassThrough } from 'node:stream';
import { LanguageServices } from '../server/language-services.ts';
import { FileLocks } from '../server/file-locks.ts';
import { textVersion } from '../server/files.ts';
import { applyTextEdits, positionOffset } from '../shared/language-service.ts';
import type { Machines } from '../server/machines.ts';
import { projectVersion, type Project, type Workspaces } from '../server/workspaces.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import { AppError } from '../server/model.ts';
import { mockProtocolOwner } from './project-protocol-fixture.ts';

/**
 * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
 * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`result`）。
 * Result: Return the branch-computed value (`result`).
 * 协作入口 / Collaborators: `Duplex.from`, `stream.on`.
 */
function pair() {
  const leftToRight = new PassThrough(), rightToLeft = new PassThrough();
  const result = [
    Duplex.from({ readable: rightToLeft, writable: leftToRight }),
    Duplex.from({ readable: leftToRight, writable: rightToLeft }),
  ] as const;
  for (const stream of result) stream.on('error', () => {});
  return result;
}
/**
 * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
 * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
 * 输入 / Inputs: message: unknown。
 * 结果：返回分支计算值（`Buffer.concat([Buffer.from(`Content-Length: ${data.length}\r\n\r\n`), data])`）。
 * Result: Return the branch-computed value (`Buffer.concat([Buffer.from(`Content-Length: ${data.length}\r\n\r\n`), data])`).
 * 协作入口 / Collaborators: `Buffer.from`, `JSON.stringify`, `Buffer.concat`.
 */
const frame = (message: unknown) => {
  const data = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${data.length}\r\n\r\n`), data]);
};
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: stream: Duplex; renameUri = 'file:///workspace/app/a.ts'; partialDiagnostics = false; observed: any[] = []。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `Buffer.alloc`, `stream.on`.
 */
function mockLanguageServer(stream: Duplex, renameUri = 'file:///workspace/app/a.ts',
  partialDiagnostics = false, observed: any[] = []) {
  let input = Buffer.alloc(0);
  stream.on('data', /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: chunk: Buffer。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `input`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `Buffer.concat`, `input.indexOf`, `Number`, `/Content-Length: (\d+)/.exec`.
   */
  (chunk: Buffer) => {
    input = Buffer.concat([input, chunk]);
    while (true) {
      const header = input.indexOf('\r\n\r\n');
      if (header < 0) return;
      const size = Number(/Content-Length: (\d+)/.exec(input.subarray(0, header).toString())?.[1]);
      if (input.length < header + 4 + size) return;
      const message = JSON.parse(input.subarray(header + 4, header + 4 + size).toString());
      observed.push(message);
      input = input.subarray(header + 4 + size);
      if (message.method === 'initialize') {
        const response = frame({ jsonrpc: '2.0', id: message.id, result: { capabilities: {} } });
        stream.write(response.subarray(0, 11));
        stream.write(response.subarray(11));
      } else if (message.method === 'textDocument/didOpen') {
        if (partialDiagnostics) stream.write(frame({ jsonrpc: '2.0',
          method: 'textDocument/publishDiagnostics', params: {
            uri: message.params.textDocument.uri, diagnostics: [],
          } }));
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`stream.write(frame({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', …`）。
         * Result: Return the branch-computed value (`stream.write(frame({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', …`).
         * 协作入口 / Collaborators: `stream.write`, `frame`.
         */
        const publish = () =>
        stream.write(frame({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: {
          uri: message.params.textDocument.uri,
          diagnostics: [{ message: 'mock warning', severity: 2, range: { start: { line: 0, character: 2 } } }],
        } }));
        if (partialDiagnostics) setTimeout(publish, 100);
        else publish();
      } else if (message.method === 'textDocument/completion') {
        stream.write(frame({ jsonrpc: '2.0', id: message.id, result: { items: [{ label: 'flower', detail: 'symbol' }] } }));
      } else if (message.method === 'textDocument/definition') {
        stream.write(frame({ jsonrpc: '2.0', id: message.id, result: {
          uri: renameUri, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 6 } },
        } }));
      } else if (message.method === 'textDocument/rename') {
        stream.write(frame({ jsonrpc: '2.0', id: message.id, result: { changes: {
          [renameUri]: [{ range: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } }, newText: message.params.newName }],
          'file:///workspace/app/b.ts': [{ range: { start: { line: 0, character: 9 }, end: { line: 0, character: 15 } }, newText: message.params.newName }],
        } } }));
      }
    }
  });
}
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: renameUri: string; partialDiagnostics = false。
 * 结果：返回受控对象，公开字段包括 `service, files, locks, project, commands, execCommands, executions, setScope, setCleanupFail`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `service, files, locks, project, commands, execCommands, executions, setScope, setCleanupFail`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `Object.defineProperty`.
 */
function fixture(renameUri?: string, partialDiagnostics = false) {
  const commands: string[] = [];
  const execCommands: string[] = [];
  const requests: any[] = [], live = {}, liveMap = new Map([['vm', live]]);
  const boundaries: Partial<Record<'config' | 'recover', /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => Promise<void>>> = {};
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: where: 'config' | 'recover'。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `operation`.
   */
  const boundary = async (where: 'config' | 'recover') => { const operation = boundaries[where]; delete boundaries[where]; await operation?.(); };
  const files = new Map([
    ['/workspace/app/a.ts', 'export const flower = 1;\n'],
    ['/workspace/app/b.ts', 'import { flower } from "./a";\n'],
  ]);
  const machines = {
    live: liveMap, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     */
    state: () => 'running',
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ distro: 'alpine' })`）。
     * Result: Return the branch-computed value (`({ distro: 'alpine' })`).
     */
    get: () => ({ distro: 'alpine' }),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `exec, end, destroy`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `exec, end, destroy`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `pair`, `mockLanguageServer`.
     */
    connect: async () => {
      const [client, server] = pair();
      mockLanguageServer(server, renameUri, partialDiagnostics);
      return { /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: command: string; done: (error: Error | undefined, stream?: Duplex) => void。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `commands.push`, `done`.
       */
      exec: (command: string, done: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: error: Error | undefined; stream: Duplex。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      (error: Error | undefined, stream?: Duplex) => void) => {
        commands.push(command);
        done(undefined, client);
      },
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 协作入口 / Collaborators: `client.destroy`, `server.destroy`.
         */
        end: () => { client.destroy(); server.destroy(); }, /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 协作入口 / Collaborators: `client.destroy`, `server.destroy`.
         */
        destroy: () => { client.destroy(); server.destroy(); } };
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; path: string。
     * 结果：返回分支计算值（`files.get(path)!`），以 Promise 交付。
     * Result: Return the branch-computed value (`files.get(path)!`) through a Promise.
     * 失败 / Failure: `new Error('missing file')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `files.has`, `files.get`.
     */
    readGuestFile: async (_id: string, path: string) => {
      if (!files.has(path)) throw new Error('missing file');
      return files.get(path)!;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _id: string; path: string; content: string; _overwrite: boolean; expected: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `assert.equal`, `textVersion`, `files.get`, `files.set`.
     * 检查边界 / Checked boundaries: `assert.equal(textVersion(files.get(path)!), expected)`.
     */
    writeGuestFile: async (_id: string, path: string, content: string, _overwrite: boolean, expected: string) => {
      assert.equal(textVersion(files.get(path)!), expected);
      files.set(path, content);
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `execCommands.push`.
     */
    exec: async (_id: string, command: string) => {
      execCommands.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  const project: Project = { directory: '/workspace/app', template: 'none', repository: '', setup: '', command: '', environment: { PROJECT_SECRET: 'private-stream-only' } };
  let scope = 'default', cleanupFail = false, closes = 0;
  Object.defineProperty(project, '_workspace', { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`scope === 'default' ? undefined : scope`）。
   * Result: Return the branch-computed value (`scope === 'default' ? undefined : scope`).
   */
  get: () => scope === 'default' ? undefined : scope, enumerable: false });
  const workspaces = { /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`project`），以 Promise 交付。
   * Result: Return the branch-computed value (`project`) through a Promise.
   * 协作入口 / Collaborators: `boundary`.
   */
  config: async () => { await boundary('config'); return project; },
    projects: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`scope`）。
     * Result: Return the branch-computed value (`scope`).
     */
    current: () => scope, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; _scope: string; action: () => Promise<unknown>。
     * 结果：返回分支计算值（`action()`）。
     * Result: Return the branch-computed value (`action()`).
     * 协作入口 / Collaborators: `action`.
     */
    inScope: (_id: string, _scope: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => action() } } as unknown as Workspaces;
  const executions: Buffer[] = [];
  const streams = { /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; kind: 'lsp' | 'dap'; original: Project; execute: (resolved: Project) => { command: string }; _signal: AbortSignal; _timeoutMs: number; expectedLive: object。
   * 结果：返回分支计算值（`mockProtocolOwner('vm', kind, original, client, verify, async () => { ++closes; …`），以 Promise 交付。
   * Result: Return the branch-computed value (`mockProtocolOwner('vm', kind, original, client, verify, async () => { ++closes; …`) through a Promise.
   * 协作入口 / Collaborators: `assert.equal`, `pair`, `mockLanguageServer`, `execute`.
   * 检查边界 / Checked boundaries: `assert.equal(expectedLive, live)`.
   */
  open: async (_id: string, kind: 'lsp' | 'dap', original: Project, execute: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: resolved: Project。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (resolved: Project) => { command: string },
    _signal?: AbortSignal, _timeoutMs?: number, expectedLive?: object) => {
    assert.equal(expectedLive, live);
    const [client, server] = pair(); mockLanguageServer(server, renameUri, partialDiagnostics, requests);
    const execution = execute(original); commands.push(execution.command);
    executions.push(projectIdentityPayload({ ...execution, environment: original.environment, stdin: 'session' }).input);
    const capture = projectVersion(original), projectId = original._workspace || 'default';
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new AppError('原项目已切换或配置改变', 409)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `projectVersion`.
     */
    const verify = async () => { if (scope !== projectId || capture !== projectVersion(project)) throw new AppError('原项目已切换或配置改变', 409); };
    return mockProtocolOwner('vm', kind, original, client, verify, async () => {
      ++closes; if (cleanupFail) throw new AppError('原完整 cgroup 仍存在', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'); server.destroy();
    });
  }, /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: _id: string; capture: { projectId: string; configSha256: string }。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 失败 / Failure: `new AppError('原项目已切换或配置改变', 409)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `projectVersion`.
   */
  assertCapture: async (_id: string, capture: { projectId: string; configSha256: string }) => {
    if (capture.projectId !== scope || capture.configSha256 !== projectVersion(project)) throw new AppError('原项目已切换或配置改变', 409);
  }, /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回列表形式的受控数据，供调用者遍历或比较。
   * Result: Return controlled data as a list for iteration or comparison.
   */
  recordsAll: async () => [], /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  readonly: async () => {}, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `boundary`.
   */
  recover: async () => { await boundary('recover'); }, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  stop: async () => {}, /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  close: async () => {} };
  const locks = new FileLocks();
  return { service: new LanguageServices(machines, workspaces, locks, { streams,
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _machines; _id; command。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `execCommands.push`.
     */
    adminTask: async (_machines, _id, command) => { execCommands.push(command); return { code: 0, stdout: '', stderr: '' }; } }),
    files, locks, project, commands, execCommands, executions, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `scope`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setScope: (value: string) => { scope = value; },
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `cleanupFail`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setCleanupFail: (value: boolean) => { cleanupFail = value; }, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`closes`）。
     * Result: Return the branch-computed value (`closes`).
     */
    closes: () => closes, requests,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`liveMap.set('vm', {})`）。
     * Result: Return the branch-computed value (`liveMap.set('vm', {})`).
     * 协作入口 / Collaborators: `liveMap.set`.
     */
    replaceLive: () => liveMap.set('vm', {}), /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: where: 'config' | 'recover'; operation: () => Promise<void>。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `boundaries[where]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setBoundary: (where: 'config' | 'recover', operation: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<void>) => { boundaries[where] = operation; } };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: language service installation provisions Python for Pyright diagnostics
 * 协作入口 / Collaborators: `fixture`, `service.install`, `assert.match`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.match(execCommands[0], /apk add --no-cache --timeout 30 python3 py3-pip nodejs npm/)`; `assert.match(execCommands[0], /env -i HOME=\/ USER=root LOGNAME=root/)`.
 */
test('language service installation provisions Python for Pyright diagnostics', async () => {
  const { service, execCommands } = fixture();
  await service.install('vm');
  assert.match(execCommands[0], /apk add --no-cache --timeout 30 python3 py3-pip nodejs npm/);
  assert.match(execCommands[0], /env -i HOME=\/ USER=root LOGNAME=root/);
  assert.match(execCommands[0], /--ignore-scripts/); assert.ok(!execCommands[0].includes('private-stream-only'));
  await service.status('vm', '/workspace/app/main.py');
  assert.match(execCommands[1], /SAKURA_PROTOCOL_ASSETS_LSP/);
  assert.ok(!execCommands[1].includes('import debugpy'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private project language server supplies project code and environment only through SESSION2 frame
 * 状态影响 / State effects: `project.networkIsolation`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `service.execute`, `files.get`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.items[0].label, 'flower')`; `assert.match(commands[0], /typescript-language-server/)`.
 */
test('private project language server supplies project code and environment only through SESSION2 frame', async () => {
  const { service, files, project, commands, executions, closes } = fixture();
  project.networkIsolation = 'private';
  const result = await service.execute('vm', { action: 'completion',
    path: '/workspace/app/a.ts', content: files.get('/workspace/app/a.ts')!,
    position: { line: 0, character: 16 } });
  assert.equal(result.items[0].label, 'flower');
  assert.match(commands[0], /typescript-language-server/);
  assert.equal(executions[0].readUInt32LE(12), 2);
  assert.ok(executions[0].includes(Buffer.from('private-stream-only')));
  assert.equal(closes(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: LSP successful protocol response cannot hide full-domain cleanup failure
 * 协作入口 / Collaborators: `fixture`, `f.setCleanupFail`, `assert.rejects`, `f.service.execute`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.execute('vm', { action: 'completion', path: '/workspace/app/a.ts', content: f.files.get('/workspace/app/a…`; `assert.equal(f.closes(), 1)`.
 */
test('LSP successful protocol response cannot hide full-domain cleanup failure', async () => {
  const f = fixture(); f.setCleanupFail(true);
  await assert.rejects(f.service.execute('vm', { action: 'completion', path: '/workspace/app/a.ts',
    content: f.files.get('/workspace/app/a.ts')!, position: { line: 0, character: 1 } }),
    { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(f.closes(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: named project rename preview rejects matching content hash from another non-enumerable scope
 * 协作入口 / Collaborators: `fixture`, `f.setScope`, `assert.equal`, `Object.keys(f.project).includes`.
 * 检查边界 / Checked boundaries: `assert.equal(Object.keys(f.project).includes('_workspace'), false)`; `assert.equal(projectVersion(f.project), digest)`.
 */
test('named project rename preview rejects matching content hash from another non-enumerable scope', async () => {
  const f = fixture(); f.setScope('1111111111111111');
  assert.equal(Object.keys(f.project).includes('_workspace'), false);
  const before = f.files.get('/workspace/app/a.ts')!, digest = projectVersion(f.project);
  const preview = await f.service.execute('vm', { action: 'rename', path: '/workspace/app/a.ts', content: before,
    position: { line: 0, character: 16 }, newName: 'petal', version: textVersion(before) });
  f.setScope('2222222222222222'); assert.equal(projectVersion(f.project), digest);
  await assert.rejects(f.service.apply('vm', preview.token), /项目已切换/);
  assert.equal(f.files.get('/workspace/app/a.ts'), before);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: TypeScript diagnostics wait past an initial empty syntax report
 * 协作入口 / Collaborators: `fixture`, `service.execute`, `files.get`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.received, true)`; `assert.equal(result.diagnostics[0]?.message, 'mock warning')`.
 */
test('TypeScript diagnostics wait past an initial empty syntax report', async () => {
  const { service, files } = fixture(undefined, true);
  const result = await service.execute('vm', { action: 'diagnostics',
    path: '/workspace/app/a.ts', content: files.get('/workspace/app/a.ts')! });
  assert.equal(result.received, true);
  assert.equal(result.diagnostics[0]?.message, 'mock warning');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: LSP UTF-16 edits validate ranges and reject overlaps
 * 协作入口 / Collaborators: `assert.equal`, `positionOffset`, `applyTextEdits`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.equal(positionOffset('a😀b\n', { line: 0, character: 3 }), 3)`; `assert.equal(applyTextEdits('abc\ndef', [ { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } }, newText: …`.
 */
test('LSP UTF-16 edits validate ranges and reject overlaps', () => {
  assert.equal(positionOffset('a😀b\n', { line: 0, character: 3 }), 3);
  assert.equal(applyTextEdits('abc\ndef', [
    { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } }, newText: 'ghi' },
    { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } }, newText: 'B' },
  ]), 'aBc\nghi');
  assert.throws(() => applyTextEdits('abc', [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, newText: 'a' },
    { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }, newText: 'b' },
  ]), /重叠/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: language services run framed LSP completion, definition, diagnostics and previewed multi-file rename
 * 协作入口 / Collaborators: `fixture`, `files.get`, `service.execute`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(completion.items[0].label, 'flower')`; `assert.equal(definition.locations[0].line, 2)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('language services run framed LSP completion, definition, diagnostics and previewed multi-file rename', async () => {
  const { service, files, locks } = fixture();
  const content = files.get('/workspace/app/a.ts')!;
  const base = { path: '/workspace/app/a.ts', content, position: { line: 0, character: 16 } };
  const completion = await service.execute('vm', { ...base, action: 'completion' });
  assert.equal(completion.items[0].label, 'flower');
  const definition = await service.execute('vm', { ...base, action: 'definition' });
  assert.equal(definition.locations[0].line, 2);
  const diagnostics = await service.execute('vm', { ...base, action: 'diagnostics' });
  assert.equal(diagnostics.received, true);
  assert.equal(diagnostics.diagnostics[0].severity, 'warning');
  const preview = await service.execute('vm', { ...base, action: 'rename', newName: 'petal', version: textVersion(content) });
  assert.equal(preview.files.length, 2);
  assert.equal(files.get('/workspace/app/a.ts'), content, 'preview must not write');
  const lease = await locks.acquire('vm', '/workspace/app/a.ts');
  await assert.rejects(service.apply('vm', preview.token), /锁定/);
  const applied = await service.apply('vm', preview.token, lease.token);
  assert.equal(applied.files.length, 2);
  assert.equal(files.get('/workspace/app/a.ts'), 'export const petal = 1;\n');
  assert.equal(files.get('/workspace/app/b.ts'), 'import { petal } from "./a";\n');
  await assert.rejects(service.apply('vm', preview.token, lease.token), /过期/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: language services reject out-of-project locations and stale rename previews
 * 状态影响 / State effects: `switched.project.directory`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `files.get`, `assert.rejects`, `service.execute`.
 * 检查边界 / Checked boundaries: `assert.rejects(service.execute('vm', { ...base, action: 'definition' }), /相对文件路径|项目目录/)`; `assert.rejects(service.execute('vm', { ...base, action: 'rename', newName: 'petal', version: textVersion(content) }), /相对文件路径|项目目录…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('language services reject out-of-project locations and stale rename previews', async () => {
  const { service, files } = fixture('file:///etc/shadow');
  const content = files.get('/workspace/app/a.ts')!;
  const base = { path: '/workspace/app/a.ts', content, position: { line: 0, character: 16 } };
  await assert.rejects(service.execute('vm', { ...base, action: 'definition' }), /相对文件路径|项目目录/);
  await assert.rejects(service.execute('vm', { ...base, action: 'rename', newName: 'petal', version: textVersion(content) }), /相对文件路径|项目目录/);
  await assert.rejects(service.execute('vm', { ...base, path: '/etc/shadow', action: 'completion' }), /相对文件路径|项目目录/);
  const normal = fixture();
  const before = normal.files.get('/workspace/app/a.ts')!;
  const preview = await normal.service.execute('vm', { ...base, action: 'rename', newName: 'petal', version: textVersion(before) });
  normal.files.set('/workspace/app/b.ts', 'changed\n');
  await assert.rejects(normal.service.apply('vm', preview.token), /改变/);
  assert.equal(normal.files.get('/workspace/app/a.ts'), before);
  const switched = fixture();
  const another = await switched.service.execute('vm', { ...base, action: 'rename', newName: 'petal', version: textVersion(before) });
  switched.project.directory = '/workspace/other';
  await assert.rejects(switched.service.apply('vm', another.token), /项目已切换/);
  assert.equal(switched.files.get('/workspace/app/a.ts'), before);
});

for (const where of ['config', 'recover'] as const) /**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `fixture`, `f.setBoundary`, `assert.rejects`, `f.service.execute`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.execute('vm', { action: 'completion', path: '/workspace/app/a.ts', content: f.files.get('/workspace/app/a…`; `assert.equal(f.commands.length, 0)`.
 */
test('LSP public request cannot authorize new live while awaiting ' + where, async () => {
  const f = fixture(); f.setBoundary(where, async () => { await new Promise(resolve => setTimeout(resolve, 0)); f.replaceLive(); });
  await assert.rejects(f.service.execute('vm', { action: 'completion', path: '/workspace/app/a.ts',
    content: f.files.get('/workspace/app/a.ts')!, position: { line: 0, character: 1 } }),
    { status: 409, code: 'PROJECT_IDENTITY_HOST_CHANGED' }); assert.equal(f.commands.length, 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: LSP public request snapshots content, path and position before awaiting config
 * 协作入口 / Collaborators: `fixture`, `f.files.get`, `f.setBoundary`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.service.execute('vm', input)).items[0].label, 'flower')`; `assert.equal(opened.params.textDocument.text, original)`.
 */
test('LSP public request snapshots content, path and position before awaiting config', async () => {
  const f = fixture(), original = f.files.get('/workspace/app/a.ts')!;
  const input = { action: 'completion' as const, path: '/workspace/app/a.ts', content: original, position: { line: 0, character: 1 } };
  f.setBoundary('config', async () => { await new Promise(resolve => setTimeout(resolve, 0)); input.path = '/etc/shadow'; input.content = 'changed'; input.position.character = 100; });
  assert.equal((await f.service.execute('vm', input)).items[0].label, 'flower');
  const opened = f.requests.find(message => message.method === 'textDocument/didOpen');
  assert.equal(opened.params.textDocument.text, original); assert.equal(opened.params.textDocument.uri, 'file:///workspace/app/a.ts');
  assert.equal(f.requests.find(message => message.method === 'textDocument/completion').params.position.character, 1);
});
