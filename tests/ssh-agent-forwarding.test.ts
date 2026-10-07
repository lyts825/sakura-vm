/**
 * 模块职责：回归验证模块，围绕 `ssh-agent-forwarding` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ssh-agent-forwarding`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: forwarding captures the target before host probing and sends code/env only to the UID task runner; forwarded cancellation holds the task lease until cleanup finishes and shared close waits for it.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectSchema } from '../server/workspaces.ts';
import { ProjectTerminals, assertProjectTerminalsStopped } from '../server/project-terminals.ts';
import { projectIdentityTask } from '../server/project-run-scope.ts';
import { SshAgentForwarder } from '../server/ssh-agent-forward.ts';
import { OwnedForwardAgent } from '../server/ssh-agent-scope.ts';
import { AppError } from '../server/model.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-agent-forward-unit-'));
const source = await readFile(new URL('../server/ssh-agent-broker.py', import.meta.url));
await writeFile(join(root, 'broker.py'), source);
await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: 1, file: 'broker.py', size: source.length,
  sha256: createHash('sha256').update(source).digest('hex') }));
after(async () => {
  const canonical = await realpath(root), parent = await realpath(tmpdir());
  assert.equal(dirname(canonical), parent); assert.ok(basename(canonical).startsWith('sakura-agent-forward-unit-'));
  await rm(canonical, { recursive: true, force: true });
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `vmId, machines, raw, live, commands, terminals, workspaces, changeProject, counts`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `vmId, machines, raw, live, commands, terminals, workspaces, changeProject, counts`; the actual branch determines its shape.
 * 状态影响 / State effects: `process.env.SSH_AUTH_SOCK`, `terminals.prepare`, `terminals.close`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `join`, `createServer`, `projectSchema.parse`.
 */
async function fixture() {
  const path = process.platform === 'win32' ? '\\\\.\\pipe\\sakura-agent-unit-' + randomUUID() : join(root, randomUUID());
  const sockets = new Set<Socket>(), server = createServer(connection => {
    sockets.add(connection); connection.on('error', () => {}); connection.once('close', () => sockets.delete(connection));
  });
  await new Promise<void>(resolve => server.listen(path, resolve));
  const previous = process.env.SSH_AUTH_SOCK; process.env.SSH_AUTH_SOCK = path;
  const vmId = randomUUID(), locks = new Machines({} as never, fakeVmNetwork), live = {}, commands: string[] = [];
  let projectId = '1111111111111111', releases = 0, closes = 0, resolves = 0;
  const raw = { ...projectSchema.parse({ directory: '/srv/projects/agent', networkIsolation: 'private',
    environment: { TOKEN: 'raw-value', SSH_AUTH_SOCK: '/tmp/wrong-agent' }, secrets: { TOKEN: 'own-key' } }), _workspace: projectId };
  const machines = { live: new Map([[vmId, live]]), /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ distro: 'alpine' })`）。
   * Result: Return the branch-computed value (`({ distro: 'alpine' })`).
   */
  get: () => ({ distro: 'alpine' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     */
    state: () => 'running', /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    requireUnlocked: () => {}, locked: locks.locked.bind(locks),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `commands.push`, `command.includes`.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stderr: '', stdout: command.includes('project-directory-migrations') ? 'null' : '' };
    } } as unknown as Machines;
  const workspaces = { /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`() => {}`）。
   * Result: Return the branch-computed value (`() => {}`).
   */
  beforeConfigChange: () => () => {}, projects: { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`projectId`）。
   * Result: Return the branch-computed value (`projectId`).
   */
  current: () => projectId,
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id: string; target: string; action: () => unknown。
     * 结果：返回分支计算值（`action()`），以 Promise 交付。
     * Result: Return the branch-computed value (`action()`) through a Promise.
     * 协作入口 / Collaborators: `assert.equal`, `action`.
     * 检查边界 / Checked boundaries: `assert.equal(target, raw._workspace, 'probe delay must not change the captured target')`.
     */
    with: async (_id: string, target: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => unknown) => {
      assert.equal(target, raw._workspace, 'probe delay must not change the captured target'); return action();
    } }, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`raw`），以 Promise 交付。
     * Result: Return the branch-computed value (`raw`) through a Promise.
     */
    config: async () => raw, /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; captured: typeof raw。
     * 结果：返回受控对象，公开字段包括 `environment`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `environment`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(captured, raw)`.
     */
    resolveProject: async (_id: string, captured: typeof raw) => {
      ++resolves; assert.equal(captured, raw);
      return { ...captured, environment: { ...captured.environment, TOKEN: 'own-private-value' } };
    }, /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('must resolve only captured config')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    resolvedConfig: async () => { throw new Error('must resolve only captured config'); }, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    close: async () => {} } as unknown as Workspaces;
  const terminals = new ProjectTerminals(machines, workspaces), prepare = terminals.prepare.bind(terminals);
  terminals.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回受控对象，公开字段包括 `release`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `release`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `prepare`.
   */
  async (...args) => {
    const prepared = await prepare(...args), release = prepared.release;
    return { ...prepared, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `release`.
     */
    release: () => { ++releases; release(); } };
  };
  const close = terminals.close.bind(terminals);
  terminals.close = /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `close`.
   */
  async () => { ++closes; await close(); };
  return { vmId, machines, raw, live, commands, terminals, workspaces,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `projectId`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    changeProject: () => { projectId = '2222222222222222'; }, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ releases, closes, resolves })`）。
     * Result: Return the branch-computed value (`({ releases, closes, resolves })`).
     */
    counts: () => ({ releases, closes, resolves }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: runner: typeof projectIdentityTask。
     * 结果：返回分支计算值（`new SshAgentForwarder(machines, { terminals, runTask: runner, sourceDirectory: r…`）。
     * Result: Return the branch-computed value (`new SshAgentForwarder(machines, { terminals, runTask: runner, sourceDirectory: r…`).
     */
    forwarder: (runner: typeof projectIdentityTask) => new SshAgentForwarder(machines,
      { terminals, runTask: runner, sourceDirectory: root }),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `process.env.SSH_AUTH_SOCK`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `terminals.close`, `socket.destroy`.
     */
    done: async () => {
      await terminals.close();
      if (previous === undefined) delete process.env.SSH_AUTH_SOCK; else process.env.SSH_AUTH_SOCK = previous;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    } };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: forwarding captures the target before host probing and sends code/env only to the UID task runner
 * 协作入口 / Collaborators: `fixture`, `f.forwarder(async (_machines, id, project, body, signal, _log, timeout, pat…`, `f.forwarder`, `f.changeProject`.
 * 检查边界 / Checked boundaries: `assert.equal(calls, 1)`; `assert.equal(result.code, 7)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('forwarding captures the target before host probing and sends code/env only to the UID task runner', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const operation = f.forwarder(async (_machines, id, project, body, signal, _log, timeout, path, callback, options) => {
      ++calls; assert.equal(id, f.vmId); assert.equal(project._workspace, f.raw._workspace);
      assert.equal(body.command, 'ssh-add -L; echo own-private-value');
      assert.equal(body.environment?.TOKEN, 'own-private-value'); assert.equal(body.environment?.SSH_AUTH_SOCK, undefined);
      assert.equal(path, undefined); assert.equal(callback, undefined); assert.equal(timeout, 60000);
      assert.equal(signal.aborted, false); assert.equal(options?.expectedLive, f.live);
      assert.ok(options?.sshAgent?.agent instanceof OwnedForwardAgent); assert.equal(options.sshAgent.resource.kind, 'ssh-agent');
      assert.throws(() => assertProjectTerminalsStopped(f.machines, f.vmId, f.raw._workspace),
        { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
      await f.machines.locked(f.vmId, async () => {});
      return { code: 7, stdout: 'own-private-value output', stderr: 'own-private-value' };
    }).run(f.vmId, { command: 'ssh-add -L; echo own-private-value', confirmed: true });
    f.changeProject();
    const result = await operation;
    assert.equal(calls, 1); assert.equal(result.code, 7); assert.equal(result.ready, false);
    assert.equal(result.stdout, '[私密配置已隐藏] output'); assert.equal(result.stderr, '[私密配置已隐藏]');
    assert.equal(result.projectId, f.raw._workspace); assert.equal(result.networkIsolation, 'private');
    assert.ok(result.configVersion); assert.deepEqual(f.counts(), { releases: 1, closes: 0, resolves: 1 });
    assert.ok(f.commands.every(command => !command.includes('own-private-value') && !command.includes('/tmp/wrong-agent')));
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.vmId, f.raw._workspace));
  } finally { await f.done(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: forwarded cancellation holds the task lease until cleanup finishes and shared close waits for it
 * 协作入口 / Collaborators: `fixture`, `f.forwarder(async (_m, _id, _p, _body, signal) => { began(); await new Prom…`, `f.forwarder`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(operation, error => error instanceof AppError && error.status === 503 && error.code === 'PROJECT_IDENTITY_CLEANUP_F…`; `assert.equal(closed, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('forwarded cancellation holds the task lease until cleanup finishes and shared close waits for it', async () => {
  const f = await fixture(); let began!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, finish!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const started = new Promise<void>(resolve => { began = resolve; }), barrier = new Promise<void>(resolve => { finish = resolve; });
  try {
    const controller = new AbortController();
    const operation = f.forwarder(async (_m, _id, _p, _body, signal) => {
      began(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      assert.throws(() => assertProjectTerminalsStopped(f.machines, f.vmId, f.raw._workspace),
        { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
      await barrier; throw new AppError('own-private-value still unconfirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    }).run(f.vmId, { command: 'sleep 600', confirmed: true }, controller.signal);
    const rejected = assert.rejects(operation, error => error instanceof AppError && error.status === 503 &&
      error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED' && !error.message.includes('own-private-value'));
    await started; controller.abort();
    let closed = false; const closing = f.terminals.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, false); assert.equal(f.counts().releases, 0);
    finish(); await rejected; await closing;
    assert.equal(f.counts().releases, 1); assert.equal(f.counts().closes, 1);
  } finally { finish(); await f.done(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a resolver-time instance replacement is passed to admission rather than followed
 * 状态影响 / State effects: `f.workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.workspaces.resolveProject.bind`, `assert.rejects`, `f.forwarder(async (_m, _id, _project, _body, _signal, _log, _timeout, _path…`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.forwarder(async (_m, _id, _project, _body, _signal, _log, _timeout, _path, _callback, options) => { ++called; ass…`; `assert.equal(called, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a resolver-time instance replacement is passed to admission rather than followed', async () => {
  const f = await fixture(); let called = 0;
  const resolve = f.workspaces.resolveProject.bind(f.workspaces);
  f.workspaces.resolveProject = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: a resolver-time instance replacement is passed to admission rather than followed
   * 协作入口 / Collaborators: `resolve`, `f.machines.live.set`.
   */
  async (...args) => {
    const result = await resolve(...args); f.machines.live.set(f.vmId, {} as never); return result;
  };
  try {
    await assert.rejects(f.forwarder(async (_m, _id, _project, _body, _signal, _log, _timeout, _path, _callback, options) => {
      ++called; assert.equal(options?.expectedLive, f.live); assert.notEqual(f.machines.live.get(f.vmId), options?.expectedLive);
      throw new AppError('captured live changed', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    }).run(f.vmId, { command: 'must-not-run', confirmed: true }), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal(called, 1); assert.equal(f.counts().releases, 1);
  } finally { await f.done(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: invalid or unconfirmed commands never prepare a lease or create an Agent owner
 * 协作入口 / Collaborators: `fixture`, `f.forwarder`, `assert.rejects`, `forwarder.run`.
 * 检查边界 / Checked boundaries: `assert.rejects(forwarder.run(f.vmId, input))`; `assert.equal(executions, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('invalid or unconfirmed commands never prepare a lease or create an Agent owner', async () => {
  const f = await fixture(); let executions = 0;
  try {
    const forwarder = f.forwarder(async () => { ++executions; return { code: 0, stdout: '', stderr: '' }; });
    for (const input of [{ command: 'true' }, { command: 'true', confirmed: false }, { command: '', confirmed: true }])
      await assert.rejects(forwarder.run(f.vmId, input));
    assert.equal(executions, 0); assert.deepEqual(f.counts(), { releases: 0, closes: 0, resolves: 0 });
  } finally { await f.done(); }
});
