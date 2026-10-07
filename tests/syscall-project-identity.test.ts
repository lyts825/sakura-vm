/**
 * 模块职责：回归验证模块，围绕 `syscall-project-identity` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `syscall-project-identity`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: host and private seccomp launches keep original UID binding, once-resolved environment and bounded stdin; concurrent outside project selection cannot change a named original operation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../server/model.ts';
import { projectVersion } from '../server/workspaces.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import { checkSyscallProfile } from '../server/syscall-profile.ts';
import { syscallIdentityFixture, syscallVmId, syscallProjectId, copySyscallProject } from './helpers/syscall-identity.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: host and private seccomp launches keep original UID binding, once-resolved environment and bounded stdin
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `f.run`, `assert.equal`, `Object.getOwnPropertyDescriptor`.
 * 检查边界 / Checked boundaries: `assert.equal(result.code, 7)`; `assert.equal(result.ready, false)`.
 */
test('host and private seccomp launches keep original UID binding, once-resolved environment and bounded stdin', async () => {
  for (const mode of ['host', 'private'] as const) {
    const f = syscallIdentityFixture(mode), result = await f.run();
    assert.equal(result.code, 7); assert.equal(result.ready, false);
    assert.equal('projectId' in result && result.projectId, syscallProjectId);
    assert.equal('directory' in result && result.directory, '/workspace/limited');
    assert.equal('networkIsolation' in result && result.networkIsolation, mode);
    const [, , project, execution, , , timeout, , , pins] = f.launches[0];
    assert.equal(project._workspace, syscallProjectId); assert.equal(project.networkIsolation, mode);
    assert.equal(Object.getOwnPropertyDescriptor(project, '_workspace')?.enumerable, false);
    assert.equal(execution.environment?.TOKEN, 'seccomp-private-value');
    assert.equal(execution.environment?.PATH, '/workspace/tools'); assert.equal('HOME' in execution.environment!, false);
    assert.match(execution.command, /^\/usr\/bin\/python3 -I -c /); assert.match(execution.command, /--run 'restricted' '60' '--' 'printf' 'UID_TEST_MARKER'$/);
    assert.equal(timeout, 75000); assert.equal(pins?.expectedLive, f.live); assert.equal(f.resolves(), 1);
    const frame = projectIdentityPayload(execution).input;
    assert.ok(frame.length < 65536 + 32); assert.ok(frame.includes(Buffer.from('UID_TEST_MARKER')));
    assert.ok(f.rootCommands.every(command => !command.includes('UID_TEST_MARKER') && !command.includes('seccomp-private-value')));
    assert.deepEqual(f.events, ['prepare', 'admin-status', 'uid-start', 'domain-stopped', 'native-closed', 'release', 'close']);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: concurrent outside project selection cannot change a named original operation
 * 状态影响 / State effects: `f.workspaces.config`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `f.run`, `assert.equal`, `f.workspaces.projects.current`.
 * 检查边界 / Checked boundaries: `assert.equal(f.launches[0][2]._workspace, syscallProjectId)`; `assert.equal(f.workspaces.projects.current(syscallVmId), 'fedcba9876543210')`.
 */
test('concurrent outside project selection cannot change a named original operation', async () => {
  const f = syscallIdentityFixture(), read = f.workspaces.config;
  f.workspaces.config = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`read(...args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`read(...args)`) through a Promise.
   * 验证场景 / Scenario: concurrent outside project selection cannot change a named original operation
   * 协作入口 / Collaborators: `Promise.resolve`, `f.switchOutside`, `read`.
   */
  async (...args) => { await Promise.resolve(); f.switchOutside(); return read(...args); };
  await f.run(); assert.equal(f.launches[0][2]._workspace, syscallProjectId);
  assert.equal(f.workspaces.projects.current(syscallVmId), 'fedcba9876543210');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lease scope, config and Live mismatches fail before administrative probe or UID execution
 * 状态影响 / State effects: `f.manager.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.launches.length, 0)`.
 */
test('lease scope, config and Live mismatches fail before administrative probe or UID execution', async () => {
  for (const corrupt of [
    (lease: any) => { lease.projectId = 'fedcba9876543210'; },
    (lease: any) => { lease.captured.live = {}; },
    (lease: any) => { lease.captured.configVersion = '0'.repeat(64); },
    (lease: any) => { lease.captured.project = copySyscallProject(lease.captured.project, 'fedcba9876543210'); },
    (lease: any) => { lease.captured.project.environment = { MODE: 'changed' }; },
  ]) {
    const f = syscallIdentityFixture(), prepare = f.manager.prepare;
    f.manager.prepare = /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`lease`），以 Promise 交付。
     * Result: Return the branch-computed value (`lease`) through a Promise.
     * 验证场景 / Scenario: lease scope, config and Live mismatches fail before administrative probe or UID execution
     * 协作入口 / Collaborators: `prepare`, `corrupt`.
     */
    async (...args) => { const lease = await prepare(...args); corrupt(lease); return lease; };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.rootCommands.length, 0); assert.equal(f.closes(), 1);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: changed original config and Live during secret resolution reject before the system probe
 * 状态影响 / State effects: `f.workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.launches.length, 0)`.
 */
test('changed original config and Live during secret resolution reject before the system probe', async () => {
  for (const change of ['config', 'live', 'scope', 'stopped']) {
    const f = syscallIdentityFixture(), resolve = f.workspaces.resolveProject;
    f.workspaces.resolveProject = /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`value`），以 Promise 交付。
     * Result: Return the branch-computed value (`value`) through a Promise.
     * 验证场景 / Scenario: changed original config and Live during secret resolution reject before the system probe
     * 状态影响 / State effects: `f.project.directory`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `resolve`, `f.machines.live.set`, `f.forceScope`, `f.setState`.
     */
    async (...args) => {
      const value = await resolve(...args);
      if (change === 'config') f.project.directory = '/workspace/other';
      if (change === 'live') f.machines.live.set(syscallVmId, {} as any);
      if (change === 'scope') f.forceScope();
      if (change === 'stopped') f.setState('stopped');
      return value;
    };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.rootCommands.length, 0); assert.equal(f.releases(), 1);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: same JSON hash with a wrong original scope cannot authorize execution
 * 状态影响 / State effects: `f.workspaces.config`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `copySyscallProject`, `assert.equal`, `projectVersion`.
 * 检查边界 / Checked boundaries: `assert.equal(projectVersion(wrong), projectVersion(f.project))`; `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`.
 */
test('same JSON hash with a wrong original scope cannot authorize execution', async () => {
  const f = syscallIdentityFixture(), read = f.workspaces.config;
  const wrong = copySyscallProject(f.project, 'fedcba9876543210');
  assert.equal(projectVersion(wrong), projectVersion(f.project));
  f.workspaces.config = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`wrong`），以 Promise 交付。
   * Result: Return the branch-computed value (`wrong`) through a Promise.
   * 验证场景 / Scenario: same JSON hash with a wrong original scope cannot authorize execution
   */
  async () => wrong;
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.rootCommands.length, 0); assert.equal(f.launches.length, 0);
  f.workspaces.config = read;
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: trusted system probes clear environment and cwd while user argv exists only in the UID frame
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `f.run`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(f.rootCommands.length, 1)`; `assert.match(command, /^\/usr\/bin\/env -i PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin HOME=\/ LANG=C LC_ALL=C \/bin\/sh -c /)`.
 */
test('trusted system probes clear environment and cwd while user argv exists only in the UID frame', async () => {
  const f = syscallIdentityFixture();
  const args = ["a' ; printf injected", '$TOKEN', '$(touch /root/uid-test)', 'hello\nworld'];
  await f.run({ mode: 'run', command: 'UID_TEST_COMMAND', args, confirmed: true });
  assert.equal(f.rootCommands.length, 1); const command = f.rootCommands[0];
  assert.match(command, /^\/usr\/bin\/env -i PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin HOME=\/ LANG=C LC_ALL=C \/bin\/sh -c /);
  assert.ok(command.includes('cd /\nset -eu')); assert.ok(command.includes('O_NOFOLLOW'));
  assert.ok(command.includes('--self-test restricted')); assert.ok(command.includes('--self-test networkless'));
  for (const value of ['UID_TEST_COMMAND', ...args, 'seccomp-private-value', '/workspace/limited']) assert.equal(command.includes(value), false);
  assert.ok(f.launches[0][3].command.includes("'UID_TEST_COMMAND'"));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: oversized accepted args fail with 413 before launching a partial command
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `assert.rejects`, `f.run`, `Array(32).fill`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run({ mode: 'run', command: 'printf', args: Array(32).fill('x'.repeat(4096)), confirmed: true }), (error: any) =>…`; `assert.equal(f.launches.length, 0)`.
 */
test('oversized accepted args fail with 413 before launching a partial command', async () => {
  const f = syscallIdentityFixture();
  await assert.rejects(f.run({ mode: 'run', command: 'printf', args: Array(32).fill('x'.repeat(4096)), confirmed: true }),
    (error: any) => error.status === 413 && error.code === 'PROJECT_IDENTITY_PAYLOAD_INVALID');
  assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancel waits for original full-domain cleanup before releasing preparation
 * 状态影响 / State effects: `f.options.runProjectTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `f.run`, `assert.rejects`, `f.abort.abort`.
 * 检查边界 / Checked boundaries: `assert.rejects(operation, (error: any) => error.name === 'AbortError')`; `assert.equal(f.releases(), 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cancel waits for original full-domain cleanup before releasing preparation', async () => {
  const f = syscallIdentityFixture(); let started!: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, closeDomain!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  const cleanup = new Promise<void>(resolve => { closeDomain = resolve; });
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: cancel waits for original full-domain cleanup before releasing preparation
   * 协作入口 / Collaborators: `assert.ok`, `f.leaseOpen`, `started`, `f.events.push`.
   * 检查边界 / Checked boundaries: `assert.ok(f.leaseOpen())`; `assert.ok(f.leaseOpen())`.
   */
  async (...args) => {
    assert.ok(f.leaseOpen()); started();
    await new Promise<void>(resolve => args[4].addEventListener('abort', () => resolve(), { once: true }));
    await cleanup; assert.ok(f.leaseOpen());
    f.events.push('domain-stopped', 'native-closed'); args[4].throwIfAborted();
    return { code: 0, stdout: '', stderr: '' };
  };
  const operation = f.run(), rejection = assert.rejects(operation, (error: any) => error.name === 'AbortError');
  await running; f.abort.abort(); await Promise.resolve();
  assert.equal(f.releases(), 0); assert.equal(f.closes(), 0); assert.ok(f.leaseOpen());
  closeDomain(); await rejection;
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
  assert.ok(f.events.indexOf('native-closed') < f.events.indexOf('release'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native cleanup 503 propagates as the original exception rather than a command result
 * 状态影响 / State effects: `f.options.runProjectTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), error => error === failure)`; `assert.equal(f.releases(), 1)`.
 */
test('native cleanup 503 propagates as the original exception rather than a command result', async () => {
  const f = syscallIdentityFixture(), failure = new AppError('original domain still running', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: native cleanup 503 propagates as the original exception rather than a command result
   * 失败 / Failure: `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw failure; };
  await assert.rejects(f.run(), error => error === failure);
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: frozen private cleanup errors keep status/code/cause while the public message is redacted
 * 状态影响 / State effects: `f.options.runProjectTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `Object.freeze`, `assert.rejects`, `f.run`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => { assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(erro…`.
 */
test('frozen private cleanup errors keep status/code/cause while the public message is redacted', async () => {
  const f = syscallIdentityFixture(), failure = Object.freeze(new AppError('seccomp-private-value original domain unknown', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'));
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: frozen private cleanup errors keep status/code/cause while the public message is redacted
   * 失败 / Failure: `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw failure; };
  await assert.rejects(f.run(), (error: any) => {
    assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(error.code, failure.code);
    assert.equal(error.cause, failure); assert.equal(error.message.includes('seccomp-private-value'), false);
    return true;
  });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: combined cleanup errors retain native status/code and every original cause
 * 状态影响 / State effects: `f.options.runProjectTask`, `f.manager.prepare`, `f.manager.close`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `assert.rejects`, `f.run`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => { assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(erro…`.
 */
test('combined cleanup errors retain native status/code and every original cause', async () => {
  const f = syscallIdentityFixture(), native = new AppError('original domain unknown', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  const release = new Error('lease release failed'), close = new Error('manager close failed');
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: combined cleanup errors retain native status/code and every original cause
   * 失败 / Failure: `native`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw native; };
  const prepare = f.manager.prepare;
  f.manager.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`lease`），以 Promise 交付。
   * Result: Return the branch-computed value (`lease`) through a Promise.
   * 验证场景 / Scenario: combined cleanup errors retain native status/code and every original cause
   * 状态影响 / State effects: `lease.release`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `prepare`.
   */
  async (...args) => {
    const lease = await prepare(...args), done = lease.release;
    lease.release = /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: combined cleanup errors retain native status/code and every original cause
     * 失败 / Failure: `release`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `done`.
     */
    async () => { await done(); throw release; }; return lease;
  };
  f.manager.close = /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: combined cleanup errors retain native status/code and every original cause
   * 失败 / Failure: `close`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw close; };
  await assert.rejects(f.run(), (error: any) => {
    assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(error.code, native.code);
    assert.equal(error.cause, native); assert.deepEqual((error as any).errors, [native, release, close]); return true;
  });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: no stale output is returned after original config changes at the UID completion boundary
 * 状态影响 / State effects: `f.options.runProjectTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.releases(), 1)`.
 */
test('no stale output is returned after original config changes at the UID completion boundary', async () => {
  const f = syscallIdentityFixture(), run = f.options.runProjectTask!;
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: no stale output is returned after original config changes at the UID completion boundary
   * 状态影响 / State effects: `f.project.directory`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `run`.
   */
  async (...args) => { const result = await run(...args); f.project.directory = '/workspace/changed'; return result; };
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: maximum configured timeout retains native task deadline and timedOut result
 * 状态影响 / State effects: `f.options.runProjectTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `f.run`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(result.code, 124)`; `assert.equal('timedOut' in result && result.timedOut, true)`.
 */
test('maximum configured timeout retains native task deadline and timedOut result', async () => {
  const f = syscallIdentityFixture(), run = f.options.runProjectTask!;
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: maximum configured timeout retains native task deadline and timedOut result
   * 协作入口 / Collaborators: `run`.
   */
  async (...args) => { await run(...args); return { code: 124, stdout: '', stderr: 'timed out' }; };
  const result = await f.run({ mode: 'run', command: 'sleep', args: ['600'], profile: 'networkless', timeoutSeconds: 300, confirmed: true });
  assert.equal(result.code, 124); assert.equal('timedOut' in result && result.timedOut, true);
  assert.equal(f.launches[0][6], 315000); assert.match(f.launches[0][3].command, /--run 'networkless' '300' '--' 'sleep' '600'$/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: readonly system status refuses a changed Live and performs no preparation
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `assert.rejects`, `checkSyscallProfile`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(checkSyscallProfile(f.machines, syscallVmId), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.launches.length, 0)`.
 */
test('readonly system status refuses a changed Live and performs no preparation', async () => {
  const f = syscallIdentityFixture(), exec = f.machines.exec;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: readonly system status refuses a changed Live and performs no preparation
   * 协作入口 / Collaborators: `exec`, `f.machines.live.set`.
   */
  async (...args) => { const result = await exec(...args); f.machines.live.set(syscallVmId, {} as any); return result; };
  await assert.rejects(checkSyscallProfile(f.machines, syscallVmId), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.launches.length, 0); assert.equal(f.resolves(), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unavailable system policies stop a prepared operation without UID fallback
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), /未就绪/)`; `assert.equal(f.launches.length, 0)`.
 */
test('unavailable system policies stop a prepared operation without UID fallback', async () => {
  const f = syscallIdentityFixture();
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ code: 1, stdout: '', stderr: 'helper digest differs' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 1, stdout: '', stderr: 'helper digest differs' })`) through a Promise.
   * 验证场景 / Scenario: unavailable system policies stop a prepared operation without UID fallback
   */
  async () => ({ code: 1, stdout: '', stderr: 'helper digest differs' });
  await assert.rejects(f.run(), /未就绪/); assert.equal(f.launches.length, 0);
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
});
