/**
 * 模块职责：回归验证模块，围绕 `debug-adapter` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `debug-adapter`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: DAP transport assembles split frames, resolves requests and buffers early events; DAP transport rejects protocol errors and an oversized frame.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Duplex } from 'node:stream';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { DapTransport } from '../server/dap-transport.ts';
import { DebugAdapter } from '../server/debug-adapter.ts';
import { AppError } from '../server/model.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import { projectVersion, type Project } from '../server/workspaces.ts';
import { mockProtocolOwner, protocolPair } from './project-protocol-fixture.ts';
import type { ProjectProtocolStreamRecord } from '../server/project-protocol-stream.ts';

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `stream, sent`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `stream, sent`; the actual branch determines its shape.
 */
function channel() {
  const sent: Buffer[] = [];
  const stream = new Duplex({
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    read() {},
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: chunk: Buffer; _encoding; callback。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `sent.push`, `Buffer.from`, `callback`.
     */
    write(chunk: Buffer, _encoding, callback) { sent.push(Buffer.from(chunk)); callback(); },
  });
  return { stream, sent };
}
/**
 * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
 * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
 * 输入 / Inputs: value: unknown。
 * 结果：返回分支计算值（`Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])`）。
 * Result: Return the branch-computed value (`Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])`).
 * 协作入口 / Collaborators: `Buffer.from`, `JSON.stringify`, `Buffer.concat`.
 */
function frame(value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: buffer: Buffer。
 * 结果：返回分支计算值（`JSON.parse(buffer.subarray(buffer.indexOf('\r\n\r\n') + 4).toString('utf8'))`）。
 * Result: Return the branch-computed value (`JSON.parse(buffer.subarray(buffer.indexOf('\r\n\r\n') + 4).toString('utf8'))`).
 * 协作入口 / Collaborators: `JSON.parse`, `buffer.subarray(buffer.indexOf('\r\n\r\n') + 4).toString`, `buffer.subarray`, `buffer.indexOf`.
 */
function decode(buffer: Buffer) {
  return JSON.parse(buffer.subarray(buffer.indexOf('\r\n\r\n') + 4).toString('utf8'));
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: DAP transport assembles split frames, resolves requests and buffers early events
 * 协作入口 / Collaborators: `channel`, `transport.request`, `decode`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(outgoing.command, 'initialize')`; `assert.deepEqual(await request, { supportsConfigurationDoneRequest: true })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('DAP transport assembles split frames, resolves requests and buffers early events', async () => {
  const { stream, sent } = channel();
  const transport = new DapTransport(stream);
  const request = transport.request('initialize', { clientID: 'sakura' });
  const outgoing = decode(sent[0]);
  assert.equal(outgoing.command, 'initialize');
  const response = frame({ seq: 2, type: 'response', request_seq: outgoing.seq,
    command: 'initialize', success: true, body: { supportsConfigurationDoneRequest: true } });
  stream.push(response.subarray(0, 7));
  stream.push(response.subarray(7));
  assert.deepEqual(await request, { supportsConfigurationDoneRequest: true });
  stream.push(frame({ seq: 3, type: 'event', event: 'initialized', body: { ready: true } }));
  assert.deepEqual(await transport.waitFor('initialized'), { ready: true });
  transport.close();
  await assert.rejects(transport.waitFor('stopped'), /连接已关闭/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: DAP transport rejects protocol errors and an oversized frame
 * 协作入口 / Collaborators: `channel`, `transport.request`, `stream.push`, `frame`.
 * 检查边界 / Checked boundaries: `assert.rejects(request, /invalid frame/)`; `assert.rejects(waiting, /响应长度无效/)`.
 */
test('DAP transport rejects protocol errors and an oversized frame', async () => {
  const { stream, sent } = channel();
  const transport = new DapTransport(stream);
  const request = transport.request('stackTrace');
  stream.push(frame({ seq: 2, type: 'response', request_seq: decode(sent[0]).seq,
    command: 'stackTrace', success: false, message: 'invalid frame' }));
  await assert.rejects(request, /invalid frame/);
  const waiting = transport.waitFor('stopped');
  stream.push(Buffer.from('Content-Length: 4194305\r\n\r\n'));
  await assert.rejects(waiting, /响应长度无效/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: debug sessions reject concurrent starts and paths outside the current project
 * 协作入口 / Collaborators: `debuggerService.start`, `assert.rejects`, `release`.
 * 检查边界 / Checked boundaries: `assert.rejects(debuggerService.start('vm', { path: '/workspace/app/main.py', breakpoints: [] }), /正在启动/)`; `assert.rejects(starting, /请先安装/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('debug sessions reject concurrent starts and paths outside the current project', async () => {
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: value: { directory: string }。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (value: { directory: string }) => void;
  const pending = new Promise<{ directory: string }>((resolve) => { release = resolve; });
  let first = true;
  const workspaces = { /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`first ? (first = false, pending) : { directory: '/workspace/app' }`），以 Promise 交付。
   * Result: Return the branch-computed value (`first ? (first = false, pending) : { directory: '/workspace/app' }`) through a Promise.
   * 验证场景 / Scenario: debug sessions reject concurrent starts and paths outside the current project
   * 状态影响 / State effects: `first`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  config: async () => first ? (first = false, pending) : { directory: '/workspace/app' },
    projects: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'default'`）。
     * Result: Return the branch-computed value (`'default'`).
     * 验证场景 / Scenario: debug sessions reject concurrent starts and paths outside the current project
     */
    current: () => 'default', /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; _scope: string; action: () => Promise<unknown>。
     * 结果：返回分支计算值（`action()`）。
     * Result: Return the branch-computed value (`action()`).
     * 验证场景 / Scenario: debug sessions reject concurrent starts and paths outside the current project
     * 协作入口 / Collaborators: `action`.
     */
    inScope: (_id: string, _scope: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => action() } };
  const machines = { live: new Map([['vm', {}]]), /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'running'`）。
   * Result: Return the branch-computed value (`'running'`).
   * 验证场景 / Scenario: debug sessions reject concurrent starts and paths outside the current project
   */
  state: () => 'running', /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ code: 1, stdout: '', stderr: '' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 1, stdout: '', stderr: '' })`) through a Promise.
   * 验证场景 / Scenario: debug sessions reject concurrent starts and paths outside the current project
   */
  exec: async () => ({ code: 1, stdout: '', stderr: '' }) };
  const debuggerService = new DebugAdapter(machines as unknown as Machines, workspaces as unknown as Workspaces,
    { streams: { /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回列表形式的受控数据，供调用者遍历或比较。
     * Result: Return controlled data as a list for iteration or comparison.
     * 验证场景 / Scenario: debug sessions reject concurrent starts and paths outside the current project
     */
    recordsAll: async () => [] } as never });
  const starting = debuggerService.start('vm', { path: '/workspace/app/main.py', breakpoints: [2] });
  await assert.rejects(debuggerService.start('vm', { path: '/workspace/app/main.py', breakpoints: [] }), /正在启动/);
  release({ directory: '/workspace/app' });
  await assert.rejects(starting, /请先安装/);
  await assert.rejects(debuggerService.start('vm', { path: '/workspace/other/main.py', breakpoints: [] }), /当前项目/);
  await assert.rejects(debuggerService.start('vm', { path: '/workspace/app/main.js', breakpoints: [] }), /Python/);
  await assert.rejects(debuggerService.start('vm', { path: '/workspace/app/main.py', breakpoints: [0] }), /断点行号/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private project debugger requests UID adapter code instead of root namespace shell execution
 * 协作入口 / Collaborators: `assert.rejects`, `debuggerService.start`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.rejects(debuggerService.start('vm', { path: '/workspace/app/main.py', breakpoints: [], }), /capture launch/)`; `assert.equal(network, 'private')`.
 */
test('private project debugger requests UID adapter code instead of root namespace shell execution', async () => {
  let launched = '', network = '';
  const workspaces = { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ directory: '/workspace/app', networkIsolation: 'private' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ directory: '/workspace/app', networkIsolation: 'private' })`) through a Promise.
   * 验证场景 / Scenario: private project debugger requests UID adapter code instead of root namespace shell execution
   */
  config: async () => ({ directory: '/workspace/app', networkIsolation: 'private' }),
    projects: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'default'`）。
     * Result: Return the branch-computed value (`'default'`).
     * 验证场景 / Scenario: private project debugger requests UID adapter code instead of root namespace shell execution
     */
    current: () => 'default', /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; _scope: string; action: () => Promise<unknown>。
     * 结果：返回分支计算值（`action()`）。
     * Result: Return the branch-computed value (`action()`).
     * 验证场景 / Scenario: private project debugger requests UID adapter code instead of root namespace shell execution
     * 协作入口 / Collaborators: `action`.
     */
    inScope: (_id: string, _scope: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => action() } };
  const machines = {
    live: new Map([['vm', {}]]), /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: private project debugger requests UID adapter code instead of root namespace shell execution
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ code: 0, stdout: '{"installed":true}', stderr: '' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 0, stdout: '{"installed":true}', stderr: '' })`) through a Promise.
     * 验证场景 / Scenario: private project debugger requests UID adapter code instead of root namespace shell execution
     */
    exec: async () => ({ code: 0, stdout: '{"installed":true}', stderr: '' }),
  };
  const debuggerService = new DebugAdapter(machines as unknown as Machines,
    workspaces as unknown as Workspaces, { streams: { /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回列表形式的受控数据，供调用者遍历或比较。
     * Result: Return controlled data as a list for iteration or comparison.
     * 验证场景 / Scenario: private project debugger requests UID adapter code instead of root namespace shell execution
     */
    recordsAll: async () => [],
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: _id: string; _kind: string; project: Project; execution: (project: Project) => { command: string }。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: private project debugger requests UID adapter code instead of root namespace shell execution
       * 状态影响 / State effects: `network`, `launched`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 失败 / Failure: `new Error('capture launch')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       * 协作入口 / Collaborators: `execution`.
       */
      open: async (_id: string, _kind: string, project: Project, execution: /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: project: Project。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      (project: Project) => { command: string }) => {
        network = project.networkIsolation!; launched = execution(project).command; throw new Error('capture launch');
      } } as never });
  await assert.rejects(debuggerService.start('vm', {
    path: '/workspace/app/main.py', breakpoints: [],
  }), /capture launch/);
  assert.equal(network, 'private'); assert.match(launched, /-I -m debugpy.adapter/);
  assert.match(launched, /test -f '\/workspace\/app\/main.py'/);
  assert.ok(!launched.includes('ip netns'));
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `service, requests, commands, frames, project, streams, closeCalls, detachCalls, setScope`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `service, requests, commands, frames, project, streams, closeCalls, detachCalls, setScope`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `Object.defineProperty`.
 */
function fixture() {
  const project: Project = { directory: '/workspace/app', template: 'none', repository: '', setup: '', command: '', environment: { PROJECT_TOKEN: 'only-protected-stream' } };
  let scope = '1111111111111111', cleanupFail = false, closeCalls = 0, detachCalls = 0, terminateAtLaunch = false;
  Object.defineProperty(project, '_workspace', { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`scope`）。
   * Result: Return the branch-computed value (`scope`).
   */
  get: () => scope, enumerable: false });
  const live = {}, liveMap = new Map([['vm', live]]);
  const boundaries: Partial<Record<'config' | 'records' | 'installed', /**
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
   * 输入 / Inputs: where: 'config' | 'records' | 'installed'。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `operation`.
   */
  const boundary = async (where: 'config' | 'records' | 'installed') => { const operation = boundaries[where]; delete boundaries[where]; await operation?.(); };
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
  const requests: any[] = [], frames: Buffer[] = [], commands: string[] = [];
  let records: ProjectProtocolStreamRecord[] = [];
  const streams = {
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`records`），以 Promise 交付。
     * Result: Return the branch-computed value (`records`) through a Promise.
     * 协作入口 / Collaborators: `boundary`.
     */
    recordsAll: async () => { await boundary('records'); return records; },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    readonly: async () => {}, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _id: string; projectId: string; token: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `records`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new AppError('full cgroup still exists', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(projectId, records[0].projectId)`; `assert.equal(token, records[0].runId)`.
     */
    stop: async (_id: string, projectId: string, token: string) => {
      assert.equal(projectId, records[0].projectId); assert.equal(token, records[0].runId);
      if (cleanupFail) throw new AppError('full cgroup still exists', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'); records = [];
    }, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    close: async () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; kind: 'lsp' | 'dap'; original: Project; execute: (project: Project) => { command: string }; _signal: AbortSignal; _timeoutMs: number; expectedLive: object。
     * 结果：返回分支计算值（`owner`），以 Promise 交付。
     * Result: Return the branch-computed value (`owner`) through a Promise.
     * 状态影响 / State effects: `owner.detachRequest`, `records`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.equal`, `protocolPair`, `execute`, `frames.push`.
     * 检查边界 / Checked boundaries: `assert.equal(expectedLive, live)`.
     */
    open: async (_id: string, kind: 'lsp' | 'dap', original: Project, execute: /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: project: Project。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (project: Project) => { command: string },
      _signal?: AbortSignal, _timeoutMs?: number, expectedLive?: object) => {
      assert.equal(expectedLive, live);
      const [client, server] = protocolPair(); const execution = execute(original);
      frames.push(projectIdentityPayload({ ...execution, environment: original.environment, stdin: 'session' }).input);
      const capturedScope = original._workspace, digest = projectVersion(original);
      const owner = mockProtocolOwner('vm', kind, original, client, async () => {
        if (scope !== capturedScope || projectVersion(project) !== digest) throw new AppError('original scope or configuration changed', 409);
      }, async () => {
        ++closeCalls; if (cleanupFail) throw new AppError('full cgroup still exists', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        records = []; server.destroy();
      });
      owner.detachRequest = /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       */
      () => { ++detachCalls; };
      records = [owner.record()];
      let input = Buffer.alloc(0), sequence = 0;
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: name: string; body: unknown = {}。
       * 结果：返回分支计算值（`server.write(frame({ seq: ++sequence, type: 'event', event: name, body }))`）。
       * Result: Return the branch-computed value (`server.write(frame({ seq: ++sequence, type: 'event', event: name, body }))`).
       * 协作入口 / Collaborators: `server.write`, `frame`.
       */
      const event = (name: string, body: unknown = {}) => server.write(frame({ seq: ++sequence, type: 'event', event: name, body }));
      server.on('data', /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: chunk: Buffer。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 状态影响 / State effects: `input`, `body`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `Buffer.concat`, `input.indexOf`, `Number`, `/Content-Length: (\d+)/.exec`.
       */
      (chunk: Buffer) => {
        input = Buffer.concat([input, chunk]);
        while (true) {
          const end = input.indexOf('\r\n\r\n'); if (end < 0) return;
          const size = Number(/Content-Length: (\d+)/.exec(input.subarray(0, end).toString())?.[1]);
          if (input.length < end + 4 + size) return;
          const request = JSON.parse(input.subarray(end + 4, end + 4 + size).toString()); input = input.subarray(end + 4 + size);
          requests.push(request);
          let body: unknown = {};
          if (request.command === 'launch') { event('initialized'); event('output', { output: 'UID debugger\u0000 output' }); }
          if (request.command === 'setBreakpoints') body = { breakpoints: request.arguments.lines.map((line: number) => ({ line, verified: true })) };
          if (request.command === 'threads') body = { threads: [{ id: 9 }] };
          if (request.command === 'stackTrace') body = { stackFrames: [{ id: 4, name: 'main', source: { path: '/workspace/app/main.py' }, line: 2, column: 1 }] };
          if (request.command === 'scopes') body = { scopes: [{ variablesReference: 42 }] };
          if (request.command === 'variables') body = { variables: [{ name: 'flower', value: '1', type: 'int', variablesReference: 43 }] };
          const response = frame({ seq: ++sequence, type: 'response', request_seq: request.seq, command: request.command, success: true, body });
          server.write(response.subarray(0, 9)); server.write(response.subarray(9));
          if (request.command === 'configurationDone') {
            if (terminateAtLaunch) event('terminated'); else event('stopped', { threadId: 9, reason: 'breakpoint' });
          }
          if (request.command === 'pause') event('stopped', { threadId: 9, reason: 'breakpoint' });
          if (['continue', 'next', 'stepIn', 'stepOut'].includes(request.command)) event('continued');
        }
      }); return owner;
    },
  };
  const machines = { live: liveMap, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'running'`）。
   * Result: Return the branch-computed value (`'running'`).
   */
  state: () => 'running', /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ distro: 'ubuntu' })`）。
   * Result: Return the branch-computed value (`({ distro: 'ubuntu' })`).
   */
  get: () => ({ distro: 'ubuntu' }), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; command: string。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `commands.push`, `boundary`.
   */
  exec: async (_id: string, command: string) => {
    commands.push(command); await boundary('installed'); return { code: 0, stdout: '{"installed":true}', stderr: '' };
  } } as unknown as Machines;
  const service = new DebugAdapter(machines, workspaces, { streams,
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _machines; _id; script。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `commands.push`.
     */
    adminTask: async (_machines, _id, script) => { commands.push(script); return { code: 0, stdout: '', stderr: '' }; } });
  return { service, requests, commands, frames, project, streams, /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`closeCalls`）。
   * Result: Return the branch-computed value (`closeCalls`).
   */
  closeCalls: () => closeCalls, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`detachCalls`）。
   * Result: Return the branch-computed value (`detachCalls`).
   */
  detachCalls: () => detachCalls,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `scope`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setScope: (value: string) => { scope = value; }, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `cleanupFail`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setCleanupFail: (value: boolean) => { cleanupFail = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `terminateAtLaunch`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    terminateAtLaunch: () => { terminateAtLaunch = true; },
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`structuredClone(records)`）。
     * Result: Return the branch-computed value (`structuredClone(records)`).
     * 协作入口 / Collaborators: `structuredClone`.
     */
    records: () => structuredClone(records), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`new DebugAdapter(machines, workspaces, { streams })`）。
     * Result: Return the branch-computed value (`new DebugAdapter(machines, workspaces, { streams })`).
     */
    reload: () => new DebugAdapter(machines, workspaces, { streams }),
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
     * 输入 / Inputs: where: 'config' | 'records' | 'installed'; operation: () => Promise<void>。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `boundaries[where]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setBoundary: (where: 'config' | 'records' | 'installed', operation: /**
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
 * 验证场景 / Scenario: DAP UID session preserves real framing, token, launch, stack, variables and commands
 * 协作入口 / Collaborators: `fixture`, `f.service.start`, `assert.equal`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal(start.state, 'stopped')`; `assert.equal(start.breakpoints[0].verified, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('DAP UID session preserves real framing, token, launch, stack, variables and commands', async () => {
  const f = fixture(); const start = await f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [2], stopOnEntry: true, args: ['hello'] });
  assert.equal(start.state, 'stopped'); assert.equal(start.breakpoints[0].verified, true);
  assert.equal(start.frames[0].path, '/workspace/app/main.py'); assert.equal(start.variables[0].name, 'flower');
  assert.ok(start.output.includes('\0')); assert.equal(f.detachCalls(), 1);
  assert.equal(f.frames[0].readUInt32LE(12), 2); assert.ok(f.frames[0].includes(Buffer.from('only-protected-stream')));
  assert.ok(f.commands.every(command => !command.includes('only-protected-stream') && !command.includes('/workspace/app')));
  const launch = f.requests.find(request => request.command === 'launch').arguments;
  assert.deepEqual(launch.args, ['hello']); assert.equal(launch.cwd, '/workspace/app'); assert.equal(launch.stopOnEntry, true);
  assert.equal((await f.service.inspect('vm', start.token, 4)).selectedFrame, 4);
  assert.equal((await f.service.expand('vm', start.token, 43)).variables[0].value, '1');
  assert.equal((await f.service.setBreakpoints('vm', start.token, [3, 3])).breakpoints[0].line, 3);
  assert.equal((await f.service.command('vm', start.token, 'next')).state, 'running');
  assert.equal((await f.service.command('vm', start.token, 'pause')).state, 'stopped');
  assert.equal((await f.service.stop('vm', start.token)).stopped, true); assert.equal(f.closeCalls(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: DAP full-domain cleanup failure preserves original token and prevents new admission until retry
 * 协作入口 / Collaborators: `fixture`, `f.service.start`, `f.records`, `f.setCleanupFail`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.stop('vm', started.token), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal((await f.service.status('vm')).token, started.token)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('DAP full-domain cleanup failure preserves original token and prevents new admission until retry', async () => {
  const f = fixture(); const started = await f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [] });
  const original = f.records(); f.setCleanupFail(true);
  await assert.rejects(f.service.stop('vm', started.token), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal((await f.service.status('vm')).token, started.token); assert.deepEqual(f.records(), original);
  await assert.rejects(f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [] }), { status: 503 });
  f.setCleanupFail(false); await f.service.stop('vm', started.token); assert.equal(f.records().length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: DAP fast program termination completes the protocol handshake and confirms the whole original domain
 * 协作入口 / Collaborators: `fixture`, `f.terminateAtLaunch`, `f.service.start`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(started.state, 'terminated')`; `assert.equal(started.active, false)`.
 */
test('DAP fast program termination completes the protocol handshake and confirms the whole original domain', async () => {
  const f = fixture(); f.terminateAtLaunch();
  const started = await f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [] });
  assert.equal(started.state, 'terminated'); assert.equal(started.active, false);
  assert.equal(f.closeCalls(), 1); assert.equal(f.records().length, 0); assert.equal(f.detachCalls(), 0);
  assert.ok(f.requests.some(request => request.command === 'configurationDone'));
  await f.service.stop('vm', started.token);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: DAP fast termination cannot report success if original full-domain cleanup fails
 * 协作入口 / Collaborators: `fixture`, `f.terminateAtLaunch`, `f.setCleanupFail`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [] }), { status: 503, code: 'PROJECT_IDENTITY_…`; `assert.equal(status.needsReview, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('DAP fast termination cannot report success if original full-domain cleanup fails', async () => {
  const f = fixture(); f.terminateAtLaunch(); f.setCleanupFail(true);
  await assert.rejects(f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [] }),
    { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  const status = await f.service.status('vm'); assert.equal(status.needsReview, true);
  assert.equal(status.token, f.records()[0].runId); assert.equal(status.active, false);
  f.setCleanupFail(false); await f.service.stop('vm', status.token!);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: DAP matching config hash cannot authorize another named scope, and readonly status emits no DAP request
 * 协作入口 / Collaborators: `fixture`, `f.service.start`, `projectVersion`, `f.setScope`.
 * 检查边界 / Checked boundaries: `assert.equal(projectVersion(f.project), digest)`; `assert.rejects(f.service.command('vm', started.token, 'continue'), { status: 409 })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('DAP matching config hash cannot authorize another named scope, and readonly status emits no DAP request', async () => {
  const f = fixture(), started = await f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [] });
  const digest = projectVersion(f.project); f.setScope('2222222222222222'); assert.equal(projectVersion(f.project), digest);
  const requests = f.requests.length;
  await assert.rejects(f.service.command('vm', started.token, 'continue'), { status: 409 });
  const status = await f.service.status('vm'); assert.equal(status.active, false); assert.equal(status.needsReview, true);
  assert.equal(f.requests.length, requests); await f.service.stop('vm', started.token);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: DAP reload reports original pending token without install or attach, then exact original stop
 * 协作入口 / Collaborators: `fixture`, `f.service.start`, `f.records`, `f.reload`.
 * 检查边界 / Checked boundaries: `assert.equal(status.active, false)`; `assert.equal(status.needsReview, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('DAP reload reports original pending token without install or attach, then exact original stop', async () => {
  const f = fixture(), started = await f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [] });
  const requests = f.requests.length, commands = f.commands.length, original = f.records();
  const reloaded = f.reload(), status = await reloaded.status('vm');
  assert.equal(status.active, false); assert.equal(status.needsReview, true); assert.equal(status.token, started.token);
  assert.deepEqual(f.records(), original); assert.equal(f.requests.length, requests); assert.equal(f.commands.length, commands);
  await assert.rejects(reloaded.start('vm', { path: '/workspace/app/main.py', breakpoints: [] }), { code: 'PROJECT_IDENTITY_RUN_STALE' });
  f.setScope('3333333333333333'); assert.equal((await reloaded.stop('vm', started.token)).stopped, true);
  await f.service.stop('vm', started.token);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: DAP administrator installation uses fixed empty environment and no project code or environment
 * 协作入口 / Collaborators: `fixture`, `f.service.install`, `assert.match`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.match(f.commands[0], /env -i HOME=\/ USER=root LOGNAME=root/)`; `assert.match(f.commands[0], /--isolated --python/)`.
 */
test('DAP administrator installation uses fixed empty environment and no project code or environment', async () => {
  const f = fixture(); await f.service.install('vm');
  assert.match(f.commands[0], /env -i HOME=\/ USER=root LOGNAME=root/);
  assert.match(f.commands[0], /--isolated --python/); assert.match(f.commands[0], /--only-binary=:all:/);
  assert.ok(!f.commands[0].includes('only-protected-stream') && !f.commands[0].includes('/workspace/app'));
});

for (const where of ['config', 'records', 'installed'] as const) /**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `fixture`, `f.setBoundary`, `assert.rejects`, `f.service.start`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [2] }), { status: 409, code: 'PROJECT_IDENTITY…`; `assert.equal(f.frames.length, 0)`.
 */
test('DAP public start cannot authorize replacement live while awaiting ' + where, async () => {
  const f = fixture(); f.setBoundary(where, async () => { await new Promise(resolve => setTimeout(resolve, 0)); f.replaceLive(); });
  await assert.rejects(f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [2] }),
    { status: 409, code: 'PROJECT_IDENTITY_HOST_CHANGED' }); assert.equal(f.frames.length, 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: DAP start copies program, args, breakpoints and stopOnEntry before first config await
 * 协作入口 / Collaborators: `fixture`, `f.setBoundary`, `f.service.start`, `f.requests.find`.
 * 检查边界 / Checked boundaries: `assert.equal(launch.program, '/workspace/app/main.py')`; `assert.deepEqual(launch.args, ['original'])`.
 */
test('DAP start copies program, args, breakpoints and stopOnEntry before first config await', async () => {
  const f = fixture(), input = { path: '/workspace/app/main.py', breakpoints: [2], args: ['original'], stopOnEntry: true };
  f.setBoundary('config', async () => {
    await new Promise(resolve => setTimeout(resolve, 0)); input.path = '/etc/shadow'; input.breakpoints[0] = 0; input.args[0] = 'mutated'; input.stopOnEntry = false;
  });
  const started = await f.service.start('vm', input), launch = f.requests.find(request => request.command === 'launch').arguments;
  assert.equal(launch.program, '/workspace/app/main.py'); assert.deepEqual(launch.args, ['original']); assert.equal(launch.stopOnEntry, true);
  assert.equal(started.breakpoints[0].line, 2); await f.service.stop('vm', started.token);
});
