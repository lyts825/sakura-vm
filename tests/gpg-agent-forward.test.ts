/**
 * 模块职责：回归验证模块，围绕 `gpg-agent-forward` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `gpg-agent-forward`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: GPG forwarding requires a confirmed, bounded single command; GPG captures the target before probing and transports only the resolved project body to the UID runner.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectSchema } from '../server/workspaces.ts';
import { ProjectTerminals, assertProjectTerminalsStopped } from '../server/project-terminals.ts';
import { projectIdentityTask } from '../server/project-run-scope.ts';
import { gpgAgentForwardInput, guestGpgForwardingReady, GpgAgentForwarder } from '../server/gpg-agent-forward.ts';
import { OwnedGpgForward } from '../server/gpg-agent-host.ts';
import { AppError } from '../server/model.ts';
import { syntheticGpgHostSnapshot } from './gpg-agent-fixture.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-gpg-forward-unit-'));
const source = await readFile(new URL('../server/gpg-agent-broker.py', import.meta.url));
await writeFile(join(root, 'broker.py'), source);
await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: 1, file: 'broker.py', size: source.length,
  sha256: createHash('sha256').update(source).digest('hex') }));
after(async () => {
  const canonical = await realpath(root), parent = await realpath(tmpdir());
  assert.equal(dirname(canonical), parent); assert.ok(basename(canonical).startsWith('sakura-gpg-forward-unit-'));
  await rm(canonical, { recursive: true, force: true });
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `vmId, live, raw, machines, terminals, workspaces, commands, changeProject, refuseForwarding`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `vmId, live, raw, machines, terminals, workspaces, commands, changeProject, refuseForwarding`; the actual branch determines its shape.
 * 状态影响 / State effects: `terminals.prepare`, `terminals.close`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `projectSchema.parse`, `locks.locked.bind`, `terminals.prepare.bind`.
 */
async function fixture() {
  const vmId = randomUUID(), locks = new Machines({} as never, fakeVmNetwork), live = {}, commands: string[] = [];
  let projectId = '1111111111111111', releases = 0, closes = 0, resolves = 0, probes = 0;
  const raw = { ...projectSchema.parse({ directory: '/srv/projects/gpg', networkIsolation: 'private',
    environment: { TOKEN: 'raw-value', GNUPGHOME: '/wrong/home', GPG_AGENT_INFO: '/wrong/agent' },
    secrets: { TOKEN: 'own-key' } }), _workspace: projectId };
  let sshConfig = 'disableforwarding no\nallowtcpforwarding remote\nallowstreamlocalforwarding remote\n';
  const machines = { live: new Map([[vmId, live]]), /**
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
   * 结果：返回分支计算值（`({ distro: 'alpine' })`）。
   * Result: Return the branch-computed value (`({ distro: 'alpine' })`).
   */
  get: () => ({ distro: 'alpine' }),
    /**
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
      return { code: 0, stderr: '', stdout: command.includes('sshd -T') ? sshConfig :
        command.includes('project-directory-migrations') ? 'null' : '' };
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
     * 检查边界 / Checked boundaries: `assert.equal(target, raw._workspace)`.
     */
    with: async (_id: string, target: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => unknown) => {
      assert.equal(target, raw._workspace); return action();
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
     * 失败 / Failure: `new Error('must resolve only the captured config')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    resolvedConfig: async () => { throw new Error('must resolve only the captured config'); },
    /**
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
  return { vmId, live, raw, machines, terminals, workspaces, commands,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `projectId`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    changeProject: () => { projectId = '2222222222222222'; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `sshConfig`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    refuseForwarding: () => { sshConfig = 'disableforwarding yes\n'; },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ releases, closes, resolves, probes })`）。
     * Result: Return the branch-computed value (`({ releases, closes, resolves, probes })`).
     */
    counts: () => ({ releases, closes, resolves, probes }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: runTask: typeof projectIdentityTask。
     * 结果：返回分支计算值（`new GpgAgentForwarder(machines, { terminals, runTask, sourceDirectory: root, cap…`）。
     * Result: Return the branch-computed value (`new GpgAgentForwarder(machines, { terminals, runTask, sourceDirectory: root, cap…`).
     */
    forwarder: (runTask: typeof projectIdentityTask) => new GpgAgentForwarder(machines,
      { terminals, runTask, sourceDirectory: root, /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`syntheticGpgHostSnapshot()`），以 Promise 交付。
       * Result: Return the branch-computed value (`syntheticGpgHostSnapshot()`) through a Promise.
       * 协作入口 / Collaborators: `syntheticGpgHostSnapshot`.
       */
      captureHost: async () => { ++probes; return syntheticGpgHostSnapshot(); } }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`terminals.close()`）。
     * Result: Return the branch-computed value (`terminals.close()`).
     * 协作入口 / Collaborators: `terminals.close`.
     */
    done: () => terminals.close() };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GPG forwarding requires a confirmed, bounded single command
 * 协作入口 / Collaborators: `fixture`, `f.forwarder`, `assert.equal`, `gpgAgentForwardInput.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(gpgAgentForwardInput.safeParse(input).success, false)`; `assert.rejects(forwarder.run(f.vmId, input))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('GPG forwarding requires a confirmed, bounded single command', async () => {
  const f = await fixture(); let executions = 0;
  try {
    const forwarder = f.forwarder(async () => { ++executions; return { code: 0, stdout: '', stderr: '' }; });
    for (const input of [{ command: 'true' }, { command: 'true', confirmed: false }, { command: '', confirmed: true },
      { command: 'true', confirmed: true, timeoutSeconds: 301 }, { command: 'true', confirmed: true, hostSocket: '/other' }]) {
      assert.equal(gpgAgentForwardInput.safeParse(input).success, false);
      await assert.rejects(forwarder.run(f.vmId, input));
    }
    assert.equal(executions, 0); assert.deepEqual(f.counts(), { releases: 0, closes: 0, resolves: 0, probes: 0 });
  } finally { await f.done(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GPG captures the target before probing and transports only the resolved project body to the UID runner
 * 协作入口 / Collaborators: `fixture`, `f.forwarder(async (_m, id, project, body, signal, _log, timeout, path, call…`, `f.forwarder`, `f.changeProject`.
 * 检查边界 / Checked boundaries: `assert.equal(calls, 1)`; `assert.equal(result.code, 7)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('GPG captures the target before probing and transports only the resolved project body to the UID runner', async () => {
  const f = await fixture(); let calls = 0;
  try {
    const operation = f.forwarder(async (_m, id, project, body, signal, _log, timeout, path, callback, options) => {
      ++calls; assert.equal(id, f.vmId); assert.equal(project._workspace, f.raw._workspace);
      assert.equal(body.command, 'gpg --sign; echo own-private-value'); assert.equal(body.environment?.TOKEN, 'own-private-value');
      assert.equal(body.environment?.GNUPGHOME, undefined); assert.equal(body.environment?.GPG_AGENT_INFO, undefined);
      assert.equal(path, undefined); assert.equal(callback, undefined); assert.equal(timeout, 60000);
      assert.equal(signal.aborted, false); assert.equal(options?.expectedLive, f.live);
      assert.ok(options?.gpgAgent?.bridge instanceof OwnedGpgForward);
      assert.equal(options.gpgAgent.resource.hostSourceSha256, syntheticGpgHostSnapshot().hostSourceSha256);
      assert.throws(() => assertProjectTerminalsStopped(f.machines, f.vmId, f.raw._workspace),
        { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
      return { code: 7, stdout: 'own-private-value output', stderr: 'own-private-value' };
    }).run(f.vmId, { command: 'gpg --sign; echo own-private-value', confirmed: true });
    f.changeProject(); const result = await operation;
    assert.equal(calls, 1); assert.equal(result.code, 7); assert.equal(result.ready, false);
    assert.equal(result.stdout, '[私密配置已隐藏] output'); assert.equal(result.stderr, '[私密配置已隐藏]');
    assert.equal(result.projectId, f.raw._workspace); assert.equal(result.networkIsolation, 'private'); assert.ok(result.configVersion);
    assert.deepEqual(f.counts(), { releases: 1, closes: 0, resolves: 1, probes: 1 });
    assert.ok(f.commands.every(command => !command.includes('own-private-value') && !command.includes('/wrong/home')));
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.vmId, f.raw._workspace));
  } finally { await f.done(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GPG cancellation holds its project lease through cleanup and redacts a cleanup refusal
 * 协作入口 / Collaborators: `fixture`, `f.forwarder(async (_m, _id, _p, _body, signal) => { began(); await new Prom…`, `f.forwarder`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(operation, error => error instanceof AppError && error.status === 503 && error.code === 'PROJECT_IDENTITY_CLEANUP_F…`; `assert.equal(closed, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('GPG cancellation holds its project lease through cleanup and redacts a cleanup refusal', async () => {
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
  const started = new Promise<void>(resolve => { began = resolve; });
  const barrier = new Promise<void>(resolve => { finish = resolve; });
  try {
    const controller = new AbortController();
    const operation = f.forwarder(async (_m, _id, _p, _body, signal) => {
      began(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      assert.throws(() => assertProjectTerminalsStopped(f.machines, f.vmId, f.raw._workspace),
        { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
      await barrier; throw new AppError('own-private-value cleanup pending', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    }).run(f.vmId, { command: 'sleep 600', confirmed: true }, controller.signal);
    const failure = assert.rejects(operation, error => error instanceof AppError && error.status === 503 &&
      error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED' && !error.message.includes('own-private-value'));
    await started; controller.abort();
    let closed = false; const closing = f.terminals.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, false); assert.equal(f.counts().releases, 0);
    finish(); await failure; await closing;
    assert.equal(f.counts().releases, 1); assert.equal(f.counts().closes, 1);
  } finally { finish(); await f.done(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a resolver-time guest replacement refuses before a GPG command is admitted
 * 状态影响 / State effects: `f.workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.workspaces.resolveProject.bind`, `assert.rejects`, `f.forwarder(async () => { ++executed; return { code: 0, stdout: '', stderr:…`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.forwarder(async () => { ++executed; return { code: 0, stdout: '', stderr: '' }; }) .run(f.vmId, { command: 'must-…`; `assert.equal(executed, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a resolver-time guest replacement refuses before a GPG command is admitted', async () => {
  const f = await fixture(); let executed = 0;
  const resolve = f.workspaces.resolveProject.bind(f.workspaces);
  f.workspaces.resolveProject = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: a resolver-time guest replacement refuses before a GPG command is admitted
   * 协作入口 / Collaborators: `resolve`, `f.machines.live.set`.
   */
  async (...args) => {
    const result = await resolve(...args); f.machines.live.set(f.vmId, {} as never); return result;
  };
  try {
    await assert.rejects(f.forwarder(async () => { ++executed; return { code: 0, stdout: '', stderr: '' }; })
      .run(f.vmId, { command: 'must-not-run', confirmed: true }), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal(executed, 0); assert.equal(f.counts().releases, 1);
    assert.ok(f.commands.every(command => !command.includes('sshd -T')));
  } finally { await f.done(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a forwarding policy refusal releases preparation without creating a GPG run
 * 协作入口 / Collaborators: `fixture`, `f.refuseForwarding`, `assert.rejects`, `f.forwarder(async () => { ++executed; return { code: 0, stdout: '', stderr:…`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.forwarder(async () => { ++executed; return { code: 0, stdout: '', stderr: '' }; }) .run(f.vmId, { command: 'must-…`; `assert.equal(executed, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a forwarding policy refusal releases preparation without creating a GPG run', async () => {
  const f = await fixture(); let executed = 0; f.refuseForwarding();
  try {
    await assert.rejects(f.forwarder(async () => { ++executed; return { code: 0, stdout: '', stderr: '' }; })
      .run(f.vmId, { command: 'must-not-run', confirmed: true }), /未允许远端 Unix/);
    assert.equal(executed, 0); assert.equal(f.counts().releases, 1);
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.vmId, f.raw._workspace));
  } finally { await f.done(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: remote Unix forwarding accepts only guest SSH settings that allow it
 * 状态影响 / State effects: `config`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `assert.equal`, `guestGpgForwardingReady`.
 * 检查边界 / Checked boundaries: `assert.equal(await guestGpgForwardingReady(machines, 'vm'), false)`; `assert.equal(await guestGpgForwardingReady(machines, 'vm'), true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('remote Unix forwarding accepts only guest SSH settings that allow it', async () => {
  let config = 'disableforwarding no\nallowtcpforwarding no\nallowstreamlocalforwarding yes\n';
  const machines = { /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ code: 0, stdout: config, stderr: '' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 0, stdout: config, stderr: '' })`) through a Promise.
   * 验证场景 / Scenario: remote Unix forwarding accepts only guest SSH settings that allow it
   */
  exec: async () => ({ code: 0, stdout: config, stderr: '' }) } as unknown as Machines;
  assert.equal(await guestGpgForwardingReady(machines, 'vm'), false);
  config = 'disableforwarding no\nallowtcpforwarding remote\nallowstreamlocalforwarding remote\n';
  assert.equal(await guestGpgForwardingReady(machines, 'vm'), true);
  config = 'disableforwarding yes\nallowtcpforwarding yes\nallowstreamlocalforwarding yes\n';
  assert.equal(await guestGpgForwardingReady(machines, 'vm'), false);
});
