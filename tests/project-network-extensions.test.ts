/**
 * 模块职责：回归验证模块，围绕 `project-network-extensions` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-network-extensions`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: private project probes stay in its namespace and SSH has no shared fallback before project setup.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectSchema, projectVersion } from '../server/workspaces.ts';
import { RuntimeVersions } from '../server/runtime-versions.ts';
import { runtimeEnvironment } from '../server/runtime-config.ts';
import { randomUUID } from 'node:crypto';
import { Toolchains } from '../server/toolchains.ts';
import { Ide } from '../server/ide.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
 * 协作入口 / Collaborators: `projectSchema.parse`, `tmpdir`, `assert.equal`, `runtimes.inspect`.
 * 检查边界 / Checked boundaries: `assert.equal((await runtimes.inspect('vm', project)).node, '1.2.3')`; `assert.equal((await tools.view('vm')).tools.find(tool => tool.id === 'node')?.required, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('private project probes stay in its namespace and SSH has no shared fallback before project setup', async () => {
  const project = projectSchema.parse({ directory: '/workspace/private', networkIsolation: 'private' });
  const commands: string[] = [];
  const identityProjects: typeof project[] = [];
  const machines = {
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
     * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
     * 协作入口 / Collaborators: `commands.push`, `command.includes`, `JSON.stringify`, `randomUUID`.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.includes('SAKURA_RUNTIME_INSTALL')) return { code: 0, stderr: '', stdout: JSON.stringify({
        version: 1, ok: true, result: { version: 1, tool: 'node', architecture: 'x86_64', requestedVersion: '1.2.3', phase: 'ready',
          installId: randomUUID(), directoryDevice: '1', directoryInode: '2', executableDevice: '1',
          executableInode: '3', executableSha256: 'a'.repeat(64) },
      }) };
      if (command.includes('SAKURA_PROJECT_SSH_STATUS'))
        return {
          code: 0,
          stdout: JSON.stringify({
            present: false,
            running: false,
            valid: false,
            processes: 0,
            reason: null,
          }),
          stderr: '',
        };
      return { code: 0, stdout: 'v1.2.3\nSAKURA_PYTHON\nPython 3.11.0\n', stderr: '' };
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ name: 'test-vm', distro: 'debian' })`）。
     * Result: Return the branch-computed value (`({ name: 'test-vm', distro: 'debian' })`).
     * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
     */
    get: () => ({ name: 'test-vm', distro: 'debian' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
     */
    state: () => 'running',
    live: new Map([['vm', { status: 'running' }]]),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; action: () => Promise<unknown>。
     * 结果：返回分支计算值（`action()`），以 Promise 交付。
     * Result: Return the branch-computed value (`action()`) through a Promise.
     * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
     * 协作入口 / Collaborators: `action`.
     */
    locked: async (_id: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => action(),
    records: new Map(),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
     */
    on: () => {},
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
     */
    off: () => {},
  } as unknown as Machines;
  const workspaces = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
     */
    config: async () => project,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; candidate: typeof project。
     * 结果：返回分支计算值（`({ ...candidate, environment: runtimeEnvironment(candidate.runtimes, candidate.e…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ...candidate, environment: runtimeEnvironment(candidate.runtimes, candidate.e…`) through a Promise.
     * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
     * 协作入口 / Collaborators: `runtimeEnvironment`.
     */
    resolveProject: async (_id: string, candidate: typeof project) => ({ ...candidate,
      environment: runtimeEnvironment(candidate.runtimes, candidate.environment?.PATH) }),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
     */
    save: async () => project,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`() => {}`）。
     * Result: Return the branch-computed value (`() => {}`).
     * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
     */
    onConfigChange: () => () => {},
    projects: {
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`'project-key'`）。
       * Result: Return the branch-computed value (`'project-key'`).
       * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
       */
      key: () => 'project-key',
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`'default'`）。
       * Result: Return the branch-computed value (`'default'`).
       * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
       */
      current: () => 'default',
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: _id: string; _project: string; action: () => unknown。
       * 结果：返回分支计算值（`action()`）。
       * Result: Return the branch-computed value (`action()`).
       * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
       * 协作入口 / Collaborators: `action`.
       */
      inScope: (_id: string, _project: string, action: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      () => unknown) => action(),
    },
  } as unknown as Workspaces;
  const runtimes = new RuntimeVersions(machines, workspaces, { /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _machines; _id; candidate。
   * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
   * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
   * 协作入口 / Collaborators: `identityProjects.push`, `JSON.stringify`, `randomUUID`.
   */
  runTask: async (_machines, _id, candidate) => {
    identityProjects.push(candidate);
    return { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true, bootId: randomUUID(),
      declared: {}, actual: { node: '1.2.3', python: '3.11.0' } }) };
  } });
  const tools = new Toolchains(machines, workspaces, {
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ prepare: async (_id, scope, _session, _readOnly, signal, _terminalId, mode) =…`）。
     * Result: Return the branch-computed value (`({ prepare: async (_id, scope, _session, _readOnly, signal, _terminalId, mode) =…`).
     * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
     */
    createPreparation: () => ({ /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id; scope; _session; _readOnly; signal; _terminalId; mode。
     * 结果：返回受控对象，公开字段包括 `command, projectId, networkIsolation, terminalId, signal, captured, release`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `command, projectId, networkIsolation, terminalId, signal, captured, release`; the actual branch determines its shape.
     * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
     * 协作入口 / Collaborators: `assert.deepEqual`, `projectVersion`, `machines.live.get`.
     * 检查边界 / Checked boundaries: `assert.deepEqual(mode, { mode: 'task' })`.
     */
    prepare: async (_id, scope, _session, _readOnly, signal, _terminalId, mode) => {
      assert.deepEqual(mode, { mode: 'task' });
      return { command: '', projectId: scope!, networkIsolation: 'private', terminalId: undefined, signal: signal!,
        captured: { project, configVersion: projectVersion(project), live: machines.live.get('vm')! }, /**
         * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
         * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
         */
        release: () => {} };
    }, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
     */
    close: async () => {} }),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _machines; _id; candidate; execution; _signal; _log; timeout; _agent; _cleanup; pins。
     * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
     * 验证场景 / Scenario: private project probes stay in its namespace and SSH has no shared fallback before project setup
     * 协作入口 / Collaborators: `identityProjects.push`, `assert.equal`, `machines.live.get`, `assert.ok`.
     * 检查边界 / Checked boundaries: `assert.equal(timeout, 20000)`; `assert.equal(pins?.expectedLive, machines.live.get('vm'))`.
     */
    runTask: async (_machines, _id, candidate, execution, _signal, _log, timeout, _agent, _cleanup, pins) => {
      identityProjects.push(candidate);
      assert.equal(timeout, 20000);
      assert.equal(pins?.expectedLive, machines.live.get('vm'));
      assert.ok(!execution.command.includes('ip netns exec'));
      assert.match(execution.command, /test ! -e 'package.json'/);
      return { code: 0, stderr: '', stdout: '\nSAKURA_TOOL_node\nv1.2.3\nSAKURA_REQUIRED_node\nyes\n' };
    },
  });
  const ide = new Ide(machines, workspaces, tmpdir());
  try {
    assert.equal((await runtimes.inspect('vm', project)).node, '1.2.3');
    await runtimes.select('vm', { node: '1.2.3' });
    assert.equal((await tools.view('vm')).tools.find(tool => tool.id === 'node')?.required, true);
    assert.equal(identityProjects.length, 3);
    for (const candidate of identityProjects) assert.equal(candidate.networkIsolation, 'private');
    assert.equal(commands.length, 1);
    // Root only verifies the fixed runtime install receipt. Toolchain versions
    // and project markers now use the same project UID task boundary.
    assert.match(commands[0], /SAKURA_RUNTIME_INSTALL/);
    const view = await ide.view('vm');
    assert.equal(view.supported, true);
    assert.ok('projectScoped' in view && view.projectScoped);
    assert.ok('runtime' in view && !view.runtime?.valid);
    assert.equal(view.command, '');
    assert.equal(view.url, '');
    assert.ok('sshCommand' in view && view.sshCommand === '');
  } finally {
    await Promise.all([runtimes.close(), tools.close(), ide.close()]);
  }
});
