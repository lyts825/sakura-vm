/**
 * 模块职责：回归验证模块，围绕 `git-workbench` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `git-workbench`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: private project Git commands bind the UID task to the original checked namespace; three-way Git editor reads index stages, rejects stale edits and stages the resolved content.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { textVersion, quote } from '../server/files.ts';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Machines as MachinesType } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectVersion, projectSchema } from '../server/workspaces.ts';
import type { GitWorkbenchOptions } from '../server/git-workbench.ts';
import type { PluginContext } from '../server/plugin-api.ts';
import type { Engine } from '../server/runtime.ts';
import { isGitConflict } from '../shared/git.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-git-test-'));
process.env.SAKURA_DATA_DIR = root;
const { GitWorkbench, gitActionSchema, parseStatus, redactGitOutput } =
  await import('../server/git-workbench.ts');
const { Machines } = await import('../server/machines.ts');
const { ProjectCatalog } = await import('../server/project-catalog.ts');
const { Jobs } = await import('../server/jobs.ts');
const { route: gitRoute } = await import('../plugins/git/server.ts');
const { route: taskRoute } = await import('../server/plugins/tasks.ts');
const execFile = promisify(execFileCallback);
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
};
const gitOptions = [
  '-c',
  'user.name=Git regression',
  '-c',
  'user.email=git@example.test',
  '-c',
  'core.autocrlf=false',
];
const shell =
  process.platform === 'win32'
    ? join(
        dirname(dirname((await execFile('where.exe', ['git'])).stdout.trim().split(/\r?\n/)[0])),
        'bin',
        'bash.exe',
      )
    : '/bin/sh';
const id = '11111111-1111-4111-8111-111111111111';
const projectId = '0123456789abcdef';
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: path: string。
 * 结果：返回分支计算值（`path.replaceAll('\\', '/')`）。
 * Result: Return the branch-computed value (`path.replaceAll('\\', '/')`).
 * 协作入口 / Collaborators: `path.replaceAll`.
 */
const posix = (path: string) => path.replaceAll('\\', '/');

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private project Git commands bind the UID task to the original checked namespace
 * 协作入口 / Collaborators: `Object.defineProperty`, `projectSchema.parse`, `t.after`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal((await service.view(id)).repository, false)`; `assert.equal(commands.length, 1)`.
 */
test('private project Git commands bind the UID task to the original checked namespace', async (t) => {
  const live = {}, project = Object.defineProperty(projectSchema.parse({ directory: '/workspace/private', networkIsolation: 'private' as const }),
    '_workspace', { value: projectId, enumerable: false });
  const commands: string[] = [];
  const machines = { live: new Map([[id, live]]), /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'running'`）。
   * Result: Return the branch-computed value (`'running'`).
   * 验证场景 / Scenario: private project Git commands bind the UID task to the original checked namespace
   */
  state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: private project Git commands bind the UID task to the original checked namespace
     * 失败 / Failure: `new Error('Root Git fallback forbidden')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    exec: async () => { throw new Error('Root Git fallback forbidden'); },
  } as unknown as MachinesType;
  const workspaces = { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`project`），以 Promise 交付。
   * Result: Return the branch-computed value (`project`) through a Promise.
   * 验证场景 / Scenario: private project Git commands bind the UID task to the original checked namespace
   */
  config: async () => project,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; captured: typeof project。
     * 结果：返回分支计算值（`({ ...captured, _workspace: projectId, environment: {} })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ...captured, _workspace: projectId, environment: {} })`) through a Promise.
     * 验证场景 / Scenario: private project Git commands bind the UID task to the original checked namespace
     */
    resolveProject: async (_id: string, captured: typeof project) => ({ ...captured, _workspace: projectId, environment: {} }),
    projects: { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`id + ':' + projectId`）。
     * Result: Return the branch-computed value (`id + ':' + projectId`).
     * 验证场景 / Scenario: private project Git commands bind the UID task to the original checked namespace
     */
    key: () => id + ':' + projectId, /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`projectId`）。
     * Result: Return the branch-computed value (`projectId`).
     * 验证场景 / Scenario: private project Git commands bind the UID task to the original checked namespace
     */
    current: () => projectId,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: _id: string; _scope: string; action: () => unknown。
       * 结果：返回分支计算值（`action()`）。
       * Result: Return the branch-computed value (`action()`).
       * 验证场景 / Scenario: private project Git commands bind the UID task to the original checked namespace
       * 协作入口 / Collaborators: `action`.
       */
      inScope: (_id: string, _scope: string, action: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      () => unknown) => action() },
  } as unknown as Workspaces;
  const options: GitWorkbenchOptions = {
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ prepare: async (_id, scope, _session, _readOnly, signal, _terminal, mode) => …`）。
     * Result: Return the branch-computed value (`({ prepare: async (_id, scope, _session, _readOnly, signal, _terminal, mode) => …`).
     * 验证场景 / Scenario: private project Git commands bind the UID task to the original checked namespace
     */
    createPreparation: () => ({ /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id; scope; _session; _readOnly; signal; _terminal; mode。
     * 结果：返回受控对象，公开字段包括 `projectId, networkIsolation, command, terminalId, signal, captured, release`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `projectId, networkIsolation, command, terminalId, signal, captured, release`; the actual branch determines its shape.
     * 验证场景 / Scenario: private project Git commands bind the UID task to the original checked namespace
     * 协作入口 / Collaborators: `assert.equal`, `assert.deepEqual`, `projectVersion`.
     * 检查边界 / Checked boundaries: `assert.equal(scope, projectId)`; `assert.deepEqual(mode, { mode: 'task' })`.
     */
    prepare: async (_id, scope, _session, _readOnly, signal, _terminal, mode) => {
      assert.equal(scope, projectId); assert.deepEqual(mode, { mode: 'task' });
      return { projectId, networkIsolation: 'private', command: 'unused', terminalId: undefined, signal: signal!,
        captured: { project, configVersion: projectVersion(project), live: live as any }, /**
         * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
         * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: private project Git commands bind the UID task to the original checked namespace
         */
        release() {} };
    }, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: private project Git commands bind the UID task to the original checked namespace
     */
    close: async () => {} }),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _machines; _id; captured; execution; _signal; _log; timeout; _agent; _cleanup; pins。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: private project Git commands bind the UID task to the original checked namespace
     * 协作入口 / Collaborators: `assert.equal`, `commands.push`.
     * 检查边界 / Checked boundaries: `assert.equal(captured._workspace, projectId)`; `assert.equal(captured.networkIsolation, 'private')`.
     */
    runProjectTask: async (_machines, _id, captured, execution, _signal, _log, timeout, _agent, _cleanup, pins) => {
      assert.equal(captured._workspace, projectId); assert.equal(captured.networkIsolation, 'private');
      assert.equal(timeout, 30000); assert.equal(pins?.expectedLive, live); commands.push(execution.command);
      return { code: 1, stdout: '', stderr: 'not a repository' };
    },
  };
  const service = new GitWorkbench(machines, workspaces, options); t.after(() => service.close());
  assert.equal((await service.view(id)).repository, false);
  assert.equal(commands.length, 1); assert.match(commands[0], /rev-parse --is-inside-work-tree/);
  assert.match(commands[0], /GIT_CONFIG_NOSYSTEM=1/);
});

after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(root.includes('sakura-git-test-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: cwd: string; args: string[]。
 * 结果：返回分支计算值（`(await execFile('git', [...gitOptions, ...args], { cwd, env })).stdout.trim()`），以 Promise 交付。
 * Result: Return the branch-computed value (`(await execFile('git', [...gitOptions, ...args], { cwd, env })).stdout.trim()`) through a Promise.
 * 协作入口 / Collaborators: `(await execFile('git', [...gitOptions, ...args], { cwd, env })).stdout.trim`, `execFile`.
 */
async function git(cwd: string, ...args: string[]) {
  return (await execFile('git', [...gitOptions, ...args], { cwd, env })).stdout.trim();
}
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: cwd: string; name: string; text: string。
 * 结果：返回分支计算值（`git(cwd, 'rev-parse', 'HEAD')`），以 Promise 交付。
 * Result: Return the branch-computed value (`git(cwd, 'rev-parse', 'HEAD')`) through a Promise.
 * 协作入口 / Collaborators: `writeFile`, `join`, `git`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function commit(cwd: string, name: string, text: string) {
  await writeFile(join(cwd, name), text);
  await git(cwd, 'add', '--', name);
  await git(cwd, 'commit', '-m', text);
  return git(cwd, 'rev-parse', 'HEAD');
}
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext。
 * 结果：返回受控对象，公开字段包括 `directory, bare, local, peer, commands, service, scope, start, run`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `directory, bare, local, peer, commands, service, scope, start, run`; the actual branch determines its shape.
 * 状态影响 / State effects: `machines.get`, `machines.state`, `machines.exec`, `service.jobs`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `git`, `commit`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(root, 'repo-'));
  const bare = join(directory, 'remote.git'),
    local = join(directory, 'local'),
    peer = join(directory, 'peer');
  await git(directory, 'init', '--bare', '--initial-branch=main', bare);
  await git(directory, 'clone', bare, local);
  await git(local, 'config', 'user.name', 'Git regression');
  await git(local, 'config', 'user.email', 'git@example.test');
  await commit(local, 'shared.txt', 'base\n');
  await git(local, 'push', '-u', 'origin', 'main');
  await git(directory, 'clone', bare, peer);
  await git(local, 'remote', 'set-url', 'origin', 'https://example.test/repository.git');
  const commands: { command: string; timeout?: number; signal?: AbortSignal }[] = [];
  const machines = new Machines({} as Engine, fakeVmNetwork);
  machines.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id }) as ReturnType<MachinesType['get']>`）。
   * Result: Return the branch-computed value (`({ id }) as ReturnType<MachinesType['get']>`).
   */
  () => ({ id }) as ReturnType<MachinesType['get']>;
  machines.state = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'running'`）。
   * Result: Return the branch-computed value (`'running'`).
   */
  () => 'running';
  const live = { status: 'running' }; machines.live.set(id, live as any);
  let projectDirectory = local;
  let beforeNetwork: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: command: string; signal: AbortSignal。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (command: string, signal?: AbortSignal) => Promise<void>) | undefined;
  let afterNetwork: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => Promise<void>) | undefined;
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command; timeout; signal。
   * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
   * 状态影响 / State effects: `command`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 失败 / Failure: `error`; `error`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `commands.push`, `command.includes`, `beforeNetwork`, `signal?.throwIfAborted`.
   * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
   * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
   */
  async (_id, command, timeout, signal) => {
    commands.push({ command, timeout, signal });
    const network = command.includes('GIT_ALLOW_PROTOCOL=https');
    if (network) {
      await beforeNetwork?.(command, signal);
      signal?.throwIfAborted();
      // Substitute only transport in the guest adapter. The workbench still validates
      // real configured HTTPS URLs; real Git executes every ref and worktree operation.
      command = command
        .replace('GIT_ALLOW_PROTOCOL=https', 'GIT_ALLOW_PROTOCOL=file')
        .replace(
          '-c protocol.https.allow=always',
          `-c protocol.file.allow=always -c 'url.${posix(bare)}.insteadOf=https://example.test/repository.git'`,
        );
    }
    try {
      const { stdout, stderr } = await execFile(shell, ['-c', command], {
        env,
        signal,
        timeout,
        maxBuffer: 1024 * 1024,
      });
      if (network) await afterNetwork?.();
      return { stdout, stderr, code: 0 };
    } catch (error) {
      if (signal?.aborted) throw error;
      const result = error as Error & { stdout: string; stderr: string; code: number };
      if (typeof result.code !== 'number') throw error;
      return { stdout: result.stdout, stderr: result.stderr, code: result.code };
    }
  };
  const projects = new ProjectCatalog(machines);
  const workspaces = {
    projects,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`Object.defineProperty({ directory: posix(projectDirectory) }, '_workspace', { va…`），以 Promise 交付。
     * Result: Return the branch-computed value (`Object.defineProperty({ directory: posix(projectDirectory) }, '_workspace', { va…`) through a Promise.
     * 协作入口 / Collaborators: `Object.defineProperty`, `posix`, `projects.current`.
     */
    config: async () => Object.defineProperty({ directory: posix(projectDirectory) }, '_workspace',
      { value: projects.current(id), enumerable: false }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; captured: any。
     * 结果：返回分支计算值（`({ ...captured, _workspace: captured._workspace, environment: {} })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ...captured, _workspace: captured._workspace, environment: {} })`) through a Promise.
     */
    resolveProject: async (_id: string, captured: any) => ({ ...captured, _workspace: captured._workspace, environment: {} }),
  } as unknown as Workspaces;
  const options: GitWorkbenchOptions = {
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `prepare, close`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `prepare, close`; the actual branch determines its shape.
     */
    createPreparation: () => {
      let held = false;
      return { /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: _id; scope; _session; _readOnly; signal; _terminal; mode。
       * 结果：返回受控对象，公开字段包括 `projectId, networkIsolation, command, terminalId, signal, captured, release`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `projectId, networkIsolation, command, terminalId, signal, captured, release`; the actual branch determines its shape.
       * 状态影响 / State effects: `held`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `assert.equal`, `assert.deepEqual`, `workspaces.config`, `projectVersion`.
       * 检查边界 / Checked boundaries: `assert.equal(scope, projectId)`; `assert.deepEqual(mode, { mode: 'task' })`.
       */
      prepare: async (_id, scope, _session, _readOnly, signal, _terminal, mode) => {
        assert.equal(scope, projectId); assert.deepEqual(mode, { mode: 'task' });
        const project = await workspaces.config(id); held = true;
        return { projectId: scope!, networkIsolation: 'host', command: 'unused', terminalId: undefined, signal: signal!,
          captured: { project, configVersion: projectVersion(project), live: live as any }, /**
           * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
           * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
           * 输入 / Inputs: 无 / none。
           * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
           * Result: No explicit result value; callers observe completion, state changes or an exception.
           * 状态影响 / State effects: `held`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
           */
          release() { held = false; } };
      }, /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `assert.equal`.
       * 检查边界 / Checked boundaries: `assert.equal(held, false)`.
       */
      close: async () => { assert.equal(held, false); } };
    },
    // This adapter runs real Git on local test repositories. It models the UID
    // boundary and never starts a VM or claims a real credential drop.
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _machines; vmId; captured; execution; signal; _log; timeout; _agent; _cleanup; pins。
     * 结果：返回分支计算值（`machines.exec(vmId, 'cd ' + quote(captured.directory) + ' && ' + execution.comma…`），以 Promise 交付。
     * Result: Return the branch-computed value (`machines.exec(vmId, 'cd ' + quote(captured.directory) + ' && ' + execution.comma…`) through a Promise.
     * 协作入口 / Collaborators: `assert.equal`, `machines.exec`, `quote`.
     * 检查边界 / Checked boundaries: `assert.equal(captured._workspace, projectId)`; `assert.equal(pins?.expectedLive, live)`.
     */
    runProjectTask: async (_machines, vmId, captured, execution, signal, _log, timeout, _agent, _cleanup, pins) => {
      assert.equal(captured._workspace, projectId); assert.equal(pins?.expectedLive, live);
      return machines.exec(vmId, 'cd ' + quote(captured.directory) + ' && ' + execution.command, timeout, signal);
    },
  };
  const service = new GitWorkbench(machines, workspaces, options);
  service.jobs = new Jobs('git', join(directory, 'jobs'));
  t.after(() => service.close());
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: action: () => T。
   * 结果：返回分支计算值（`projects.inScope(id, projectId, action)`）。
   * Result: Return the branch-computed value (`projects.inScope(id, projectId, action)`).
   * 协作入口 / Collaborators: `projects.inScope`.
   */
  const scope = <T>(action: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => T) => projects.inScope(id, projectId, action);
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: value: unknown。
   * 结果：返回分支计算值（`scope(() => service.run(id, value))`）。
   * Result: Return the branch-computed value (`scope(() => service.run(id, value))`).
   * 协作入口 / Collaborators: `scope`.
   */
  const start = (value: unknown) => scope(() => service.run(id, value));
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: value: unknown。
   * 结果：返回分支计算值（`job`），以 Promise 交付。
   * Result: Return the branch-computed value (`job`) through a Promise.
   * 协作入口 / Collaborators: `start`, `service.jobs.wait`.
   */
  const run = async (value: unknown) => {
    const job = await start(value);
    await service.jobs.wait(job.key!);
    return job;
  };
  const host = {
    vm: machines,
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: reference: { pluginId: string; key: string }。
     * 结果：返回分支计算值（`service`）。
     * Result: Return the branch-computed value (`service`).
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(reference.pluginId, 'git')`; `assert.equal(reference.key, 'git')`.
     */
    use(reference: { pluginId: string; key: string }) {
      assert.equal(reference.pluginId, 'git');
      assert.equal(reference.key, 'git');
      return service;
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回列表形式的受控数据，供调用者遍历或比较。
     * Result: Return controlled data as a list for iteration or comparison.
     */
    jobStores: () => [service.jobs],
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`undefined`）。
     * Result: Return the branch-computed value (`undefined`).
     */
    retryHandler: () => undefined,
  } as unknown as PluginContext & Pick<import('../server/plugin-runtime.ts').PluginRuntime, 'jobStores' | 'retryHandler'>;
  return {
    directory,
    bare,
    local,
    peer,
    commands,
    service,
    scope,
    start,
    run,
    host,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: path: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `projectDirectory`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setDirectory: (path: string) => {
      projectDirectory = path;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: fn: typeof beforeNetwork。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `beforeNetwork`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    beforeNetwork: (fn: typeof beforeNetwork) => {
      beforeNetwork = fn;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: fn: typeof afterNetwork。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `afterNetwork`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    afterNetwork: (fn: typeof afterNetwork) => {
      afterNetwork = fn;
    },
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: three-way Git editor reads index stages, rejects stale edits and stages the resolved content
 * 状态影响 / State effects: `(f.host.vm as any).readGuestFile`, `(f.host.vm as any).writeGuestFile`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `git`, `commit`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(git(f.local, 'merge', 'topic'))`; `assert.equal(versions.base, 'base\n')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('three-way Git editor reads index stages, rejects stale edits and stages the resolved content', async (t) => {
  const f = await fixture(t);
  (f.host.vm as any).readGuestFile = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: _id: string; path: string。
   * 结果：返回分支计算值（`readFile(path, 'utf8')`），以 Promise 交付。
   * Result: Return the branch-computed value (`readFile(path, 'utf8')`) through a Promise.
   * 验证场景 / Scenario: three-way Git editor reads index stages, rejects stale edits and stages the resolved content
   * 协作入口 / Collaborators: `readFile`.
   */
  async (_id: string, path: string) => readFile(path, 'utf8');
  (f.host.vm as any).writeGuestFile = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: _id: string; path: string; content: string; _overwrite: boolean; version: string。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: three-way Git editor reads index stages, rejects stale edits and stages the resolved content
   * 协作入口 / Collaborators: `assert.equal`, `textVersion`, `readFile`, `writeFile`.
   * 检查边界 / Checked boundaries: `assert.equal(textVersion(await readFile(path, 'utf8')), version)`.
   */
  async (
    _id: string,
    path: string,
    content: string,
    _overwrite: boolean,
    version: string,
  ) => {
    assert.equal(textVersion(await readFile(path, 'utf8')), version);
    await writeFile(path, content);
  };
  await git(f.local, 'switch', '-c', 'topic');
  await commit(f.local, 'shared.txt', 'theirs\n');
  await git(f.local, 'switch', 'main');
  await commit(f.local, 'shared.txt', 'ours\n');
  await assert.rejects(git(f.local, 'merge', 'topic'));
  const versions = await f.scope(() => f.service.mergeInputs(id, 'shared.txt'));
  assert.equal(versions.base, 'base\n');
  assert.equal(versions.ours, 'ours\n');
  assert.equal(versions.theirs, 'theirs\n');
  await writeFile(join(f.local, 'shared.txt'), 'new edit\n');
  const stale = await f.run({
    action: 'resolve',
    path: versions.path,
    expectedVersion: versions.expectedVersion,
    expectedIndex: versions.expectedIndex,
    content: 'stale\n',
  });
  assert.equal(stale.status, 'error');
  assert.match(stale.error!, /已变化/);
  assert.equal(await readFile(join(f.local, 'shared.txt'), 'utf8'), 'new edit\n');
  const fresh = await f.scope(() => f.service.mergeInputs(id, 'shared.txt'));
  const saved = await f.run({
    action: 'resolve',
    path: fresh.path,
    expectedVersion: fresh.expectedVersion,
    expectedIndex: fresh.expectedIndex,
    content: 'merged\n',
  });
  assert.equal(saved.status, 'done', saved.error);
  assert.equal(await git(f.local, 'show', ':shared.txt'), 'merged');
  assert.equal(await git(f.local, 'ls-files', '--unmerged'), '');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Git conflict choices stage binary versions and reject an edited worktree
 * 协作入口 / Collaborators: `fixture`, `join`, `writeFile`, `Buffer.from`.
 * 检查边界 / Checked boundaries: `assert.rejects(git(f.local, 'merge', 'topic'))`; `assert.equal(context.ours?.mode, '100644')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('Git conflict choices stage binary versions and reject an edited worktree', async (t) => {
  const f = await fixture(t);
  const file = join(f.local, 'artifact.bin');
  await writeFile(file, Buffer.from([0, 1, 2]));
  await git(f.local, 'add', '--', 'artifact.bin');
  await git(f.local, 'commit', '-m', 'binary base');
  await git(f.local, 'switch', '-c', 'topic');
  await writeFile(file, Buffer.from([0, 3, 2]));
  await git(f.local, 'commit', '-am', 'theirs');
  await git(f.local, 'switch', 'main');
  await writeFile(file, Buffer.from([0, 4, 2]));
  await git(f.local, 'commit', '-am', 'ours');
  await assert.rejects(git(f.local, 'merge', 'topic'));
  const context = await f.scope(() => f.service.conflictChoices(id, 'artifact.bin'));
  assert.equal(context.ours?.mode, '100644');
  assert.equal(context.theirs?.mode, '100644');
  await writeFile(file, Buffer.from([0, 5, 2]));
  const stale = await f.run({
    action: 'resolve-choice', path: context.path, choice: 'theirs',
    expectedIndex: context.expectedIndex, expectedWorktree: context.expectedWorktree,
  });
  assert.equal(stale.status, 'error');
  assert.match(stale.error!, /已变化/);
  assert.deepEqual(await readFile(file), Buffer.from([0, 5, 2]));
  const fresh = await f.scope(() => f.service.conflictChoices(id, 'artifact.bin'));
  const resolved = await f.run({
    action: 'resolve-choice', path: fresh.path, choice: 'theirs',
    expectedIndex: fresh.expectedIndex, expectedWorktree: fresh.expectedWorktree,
  });
  assert.equal(resolved.status, 'done', resolved.error);
  assert.equal(await git(f.local, 'rev-parse', ':artifact.bin'), fresh.theirs?.oid);
  assert.deepEqual(await readFile(file), Buffer.from([0, 3, 2]));
  assert.equal(await git(f.local, 'ls-files', '--unmerged'), '');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Git conflict choices can accept a deleted side
 * 协作入口 / Collaborators: `fixture`, `git`, `commit`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(git(f.local, 'merge', 'topic'))`; `assert.ok(context.ours)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('Git conflict choices can accept a deleted side', async (t) => {
  const f = await fixture(t);
  await git(f.local, 'switch', '-c', 'topic');
  await git(f.local, 'rm', '--', 'shared.txt');
  await git(f.local, 'commit', '-m', 'delete shared');
  await git(f.local, 'switch', 'main');
  await commit(f.local, 'shared.txt', 'updated\n');
  await assert.rejects(git(f.local, 'merge', 'topic'));
  const context = await f.scope(() => f.service.conflictChoices(id, 'shared.txt'));
  assert.ok(context.ours);
  assert.equal(context.theirs, null);
  const result = await f.run({
    action: 'resolve-choice', path: context.path, choice: 'theirs',
    expectedIndex: context.expectedIndex, expectedWorktree: context.expectedWorktree,
  });
  assert.equal(result.status, 'done', result.error);
  assert.equal(await git(f.local, 'ls-files', '--unmerged'), '');
  await assert.rejects(readFile(join(f.local, 'shared.txt')), { code: 'ENOENT' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Git conflict choices preserve the selected symbolic-link index entry
 * 协作入口 / Collaborators: `fixture`, `stage`, `git`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(git(f.local, 'merge', 'topic'))`; `assert.equal(context.theirs?.mode, '120000')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('Git conflict choices preserve the selected symbolic-link index entry', async (t) => {
  const f = await fixture(t);
  const linkName = 'shortcut';
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: target: string。
   * 结果：返回分支计算值（`oid`），以 Promise 交付。
   * Result: Return the branch-computed value (`oid`) through a Promise.
   * 验证场景 / Scenario: Git conflict choices preserve the selected symbolic-link index entry
   * 协作入口 / Collaborators: `join`, `writeFile`, `git`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  const stage = async (target: string) => {
    const source = join(f.directory, 'link-target');
    await writeFile(source, target);
    const oid = await git(f.local, 'hash-object', '-w', source);
    await git(f.local, 'update-index', '--add', '--cacheinfo', `120000,${oid},${linkName}`);
    await git(f.local, 'checkout-index', '-f', '--', linkName);
    return oid;
  };
  await stage('base-target');
  await git(f.local, 'commit', '-m', 'link base');
  await git(f.local, 'switch', '-c', 'topic');
  const theirs = await stage('theirs-target');
  await git(f.local, 'commit', '-m', 'link theirs');
  await git(f.local, 'switch', 'main');
  await stage('ours-target');
  await git(f.local, 'commit', '-m', 'link ours');
  await assert.rejects(git(f.local, 'merge', 'topic'));
  const context = await f.scope(() => f.service.conflictChoices(id, linkName));
  assert.equal(context.theirs?.mode, '120000');
  assert.equal(context.theirs?.oid, theirs);
  const resolved = await f.run({
    action: 'resolve-choice', path: linkName, choice: 'theirs',
    expectedIndex: context.expectedIndex, expectedWorktree: context.expectedWorktree,
  });
  assert.equal(resolved.status, 'done', resolved.error);
  assert.equal(await git(f.local, 'rev-parse', `:${linkName}`), theirs);
  assert.equal(await git(f.local, 'ls-files', '--unmerged'), '');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Git conflict choices stage a selected gitlink without changing its work directory
 * 协作入口 / Collaborators: `fixture`, `git`, `commit`, `[ `0 ${'0'.repeat(40)}\tmodule`, `160000 ${base} 1\tmodule`, `160000 ${ours…`.
 * 检查边界 / Checked boundaries: `assert.equal(context.worktree, 'missing')`; `assert.equal(context.theirs?.mode, '160000')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('Git conflict choices stage a selected gitlink without changing its work directory', async (t) => {
  const f = await fixture(t);
  const base = await git(f.local, 'rev-parse', 'HEAD');
  const ours = await commit(f.local, 'ours.txt', 'ours\n');
  const theirs = await commit(f.local, 'theirs.txt', 'theirs\n');
  const index = [
    `0 ${'0'.repeat(40)}\tmodule`,
    `160000 ${base} 1\tmodule`,
    `160000 ${ours} 2\tmodule`,
    `160000 ${theirs} 3\tmodule`,
    '',
  ].join('\n');
  await new Promise<void>((done, reject) => {
    const child = spawn('git', [...gitOptions, 'update-index', '--index-info'], { cwd: f.local, env });
    let error = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { error += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? done() : reject(new Error(error)));
    child.stdin.end(index);
  });
  const context = await f.scope(() => f.service.conflictChoices(id, 'module'));
  assert.equal(context.worktree, 'missing');
  assert.equal(context.theirs?.mode, '160000');
  const result = await f.run({
    action: 'resolve-choice', path: 'module', choice: 'theirs',
    expectedIndex: context.expectedIndex, expectedWorktree: context.expectedWorktree,
  });
  assert.equal(result.status, 'done', result.error);
  assert.equal(await git(f.local, 'rev-parse', ':module'), theirs);
  assert.equal(await git(f.local, 'ls-files', '--unmerged'), '');
  await assert.rejects(stat(join(f.local, 'module')), { code: 'ENOENT' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: remote inputs reject refspecs, revisions, flags, shell syntax and credential URLs
 * 协作入口 / Collaborators: `assert.equal`, `gitActionSchema.safeParse`, `assert.ok`, `isGitConflict`.
 * 检查边界 / Checked boundaries: `assert.equal(gitActionSchema.safeParse({ action, branch }).success, false, `${action}: ${branch}`)`; `assert.equal(gitActionSchema.safeParse({ action, remote }).success, false)`.
 */
test('remote inputs reject refspecs, revisions, flags, shell syntax and credential URLs', () => {
  for (const action of ['fetch', 'pull', 'push']) {
    for (const branch of [
      '--force',
      'HEAD',
      'HEAD~1',
      'main:other',
      '+main',
      'main..other',
      'a/.hidden',
      'a.lock',
      'a//b',
      'main;id',
      '$(id)',
    ])
      assert.equal(gitActionSchema.safeParse({ action, branch }).success, false, `${action}: ${branch}`);
    for (const remote of ['--all', 'https://example.test/repo', 'origin;id', 'origin..bad'])
      assert.equal(gitActionSchema.safeParse({ action, remote }).success, false);
    assert.equal(gitActionSchema.safeParse({ action, force: true }).success, false);
  }
  for (const url of [
    'not a URL',
    'file:///tmp/repo',
    'ssh://git@example.test/repo',
    'https://user:secret@example.test/repo',
    'https://example.test/repo?token=secret',
  ])
    assert.equal(gitActionSchema.safeParse({ action: 'remote-add', name: 'origin', url }).success, false);
  for (const pair of ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
    assert.ok(isGitConflict(parseStatus(`${pair} conflict name.txt\0`)[0]));
  assert.equal(isGitConflict(parseStatus(' M ordinary.txt\0')[0]), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: fetch changes only remote tracking refs despite dangerous repository defaults
 * 协作入口 / Collaborators: `fixture`, `git`, `commit`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done', job.error)`; `assert.equal(await git(f.local, 'rev-parse', 'refs/remotes/origin/main'), next)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('fetch changes only remote tracking refs despite dangerous repository defaults', async (t) => {
  const f = await fixture(t);
  const head = await git(f.local, 'rev-parse', 'HEAD');
  const next = await commit(f.peer, 'shared.txt', 'remote update\n');
  await git(f.peer, 'push');
  await writeFile(join(f.local, 'shared.txt'), 'my uncommitted work\n');
  await git(f.local, 'branch', 'keep-local');
  await git(f.local, 'tag', 'keep-tag');
  await git(f.local, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*');
  await git(f.local, 'config', 'fetch.prune', 'true');
  await git(f.local, 'config', 'fetch.pruneTags', 'true');
  const job = await f.run({ action: 'fetch' });
  assert.equal(job.status, 'done', job.error);
  assert.equal(await git(f.local, 'rev-parse', 'refs/remotes/origin/main'), next);
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), head);
  assert.equal(await git(f.local, 'rev-parse', 'keep-local'), head);
  assert.equal(await git(f.local, 'rev-parse', 'keep-tag'), head);
  assert.equal(await readFile(join(f.local, 'shared.txt'), 'utf8'), 'my uncommitted work\n');
  assert.equal(job.projectId, projectId);
  assert.equal(job.vmId, id);
  assert.equal(job.key, `${id}:${projectId}`);
  const network = f.commands.find((value) => value.command.includes('GIT_ALLOW_PROTOCOL=https'))!;
  assert.equal(network.timeout, 120000);
  assert.match(network.command, /GIT_TERMINAL_PROMPT=0.*GIT_ASKPASS=\/bin\/false/);
  assert.match(network.command, /--refmap= .*\+refs\/heads\/\*:refs\/remotes\/origin\/\*/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pull honors the differently named upstream and fast-forwards without configured rebase or squash
 * 协作入口 / Collaborators: `fixture`, `git`, `commit`, `f.run`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done', job.error)`; `assert.equal(await git(f.local, 'rev-parse', 'HEAD'), next)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('pull honors the differently named upstream and fast-forwards without configured rebase or squash', async (t) => {
  const f = await fixture(t);
  await git(f.local, 'branch', '-m', 'local-topic');
  await git(f.local, 'config', 'pull.rebase', 'true');
  await git(f.local, 'config', 'merge.autoStash', 'true');
  await git(f.local, 'config', 'branch.local-topic.mergeOptions', '--squash');
  const next = await commit(f.peer, 'shared.txt', 'remote update\n');
  await git(f.peer, 'push');
  const job = await f.run({ action: 'pull' });
  assert.equal(job.status, 'done', job.error);
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), next);
  assert.equal(await git(f.local, 'branch', '--show-current'), 'local-topic');
  const view = await f.scope(() => f.service.view(id));
  assert.deepEqual(view.upstream, { name: 'origin/main', remote: 'origin', branch: 'main' });
  assert.deepEqual(view.divergence, [0, 0]);
  assert.deepEqual(view.changes, []);
  assert.equal(view.operation, null);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: dirty pulls preserve staged, unstaged and untracked work without fetching or autostashing
 * 协作入口 / Collaborators: `fixture`, `git`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(job.errorCode, 'git_dirty_worktree')`; `assert.equal(await git(f.local, 'status', '--porcelain=v1'), before)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('dirty pulls preserve staged, unstaged and untracked work without fetching or autostashing', async (t) => {
  const f = await fixture(t);
  const head = await git(f.local, 'rev-parse', 'HEAD');
  await git(f.local, 'config', 'merge.autoStash', 'true');
  for (const kind of ['unstaged', 'staged', 'untracked']) {
    const name = kind === 'untracked' ? 'new.txt' : 'shared.txt';
    await writeFile(join(f.local, name), kind);
    if (kind === 'staged') await git(f.local, 'add', name);
    const before = await git(f.local, 'status', '--porcelain=v1');
    const job = await f.run({ action: 'pull' });
    assert.equal(job.errorCode, 'git_dirty_worktree');
    assert.equal(await git(f.local, 'status', '--porcelain=v1'), before);
    assert.equal(await readFile(join(f.local, name), 'utf8'), kind);
    assert.equal(await git(f.local, 'rev-parse', 'HEAD'), head);
    await git(f.local, 'reset', '--hard', head);
  }
  assert.ok(!f.commands.some((value) => value.command.includes('GIT_ALLOW_PROTOCOL=https')));
  assert.equal(await git(f.local, 'stash', 'list'), '');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: diverged pull and non-fast-forward push report explicit failures and preserve both histories
 * 协作入口 / Collaborators: `fixture`, `commit`, `git`, `f.run`.
 * 检查边界 / Checked boundaries: `assert.equal(pull.status, 'error')`; `assert.equal(pull.errorCode, 'git_diverged')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('diverged pull and non-fast-forward push report explicit failures and preserve both histories', async (t) => {
  const f = await fixture(t);
  const localHead = await commit(f.local, 'local.txt', 'local commit\n');
  const remoteHead = await commit(f.peer, 'remote.txt', 'remote commit\n');
  await git(f.peer, 'push');
  const pull = await f.run({ action: 'pull', remote: 'origin', branch: 'main' });
  assert.equal(pull.status, 'error');
  assert.equal(pull.errorCode, 'git_diverged');
  assert.match(pull.error!, /分叉.*快进/);
  const push = await f.run({ action: 'push', remote: 'origin', branch: 'main' });
  assert.equal(push.errorCode, 'git_push_rejected', push.error);
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), localHead);
  assert.equal(await git(f.bare, 'rev-parse', 'main'), remoteHead);
  assert.equal(await git(f.local, 'status', '--porcelain=v1'), '');
  assert.deepEqual((await f.scope(() => f.service.view(id))).divergence, [1, 1]);
  await assert.rejects(stat(join(f.local, '.git', 'MERGE_HEAD')), { code: 'ENOENT' });
  await f.service.jobs.flush();
  const restored = new Jobs('git', join(f.directory, 'jobs'));
  assert.equal(restored.get(push.id!)?.errorCode, 'git_push_rejected');
  await restored.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: push sends only the current commit to the chosen branch despite mirror, push refspec and tag defaults
 * 协作入口 / Collaborators: `fixture`, `git`, `commit`, `f.run`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done', job.error)`; `assert.equal(await git(f.bare, 'rev-parse', 'review/topic'), head)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('push sends only the current commit to the chosen branch despite mirror, push refspec and tag defaults', async (t) => {
  const f = await fixture(t);
  const oldHead = await git(f.bare, 'rev-parse', 'main');
  const head = await commit(f.local, 'local.txt', 'current commit\n');
  await git(f.local, 'branch', 'unrelated');
  await git(f.local, 'tag', '-a', 'private-tag', '-m', 'tag');
  await git(f.local, 'config', 'remote.origin.mirror', 'true');
  await git(f.local, 'config', 'remote.origin.push', '+refs/heads/*:refs/heads/*');
  await git(f.local, 'config', 'push.followTags', 'true');
  const job = await f.run({ action: 'push', branch: 'review/topic' });
  assert.equal(job.status, 'done', job.error);
  assert.equal(await git(f.bare, 'rev-parse', 'review/topic'), head);
  assert.equal(await git(f.bare, 'rev-parse', 'main'), oldHead);
  assert.equal(
    await git(f.bare, 'for-each-ref', '--format=%(refname)', 'refs/heads'),
    'refs/heads/main\nrefs/heads/review/topic',
  );
  assert.equal(await git(f.bare, 'tag'), '');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: file conflicts and resolved-but-unfinished merges block pull, push and conflicted commits
 * 协作入口 / Collaborators: `fixture`, `git`, `commit`, `f.run`.
 * 检查边界 / Checked boundaries: `assert.equal(merge.errorCode, 'git_conflict', merge.error)`; `assert.deepEqual(view.conflicts, ['shared.txt'])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('file conflicts and resolved-but-unfinished merges block pull, push and conflicted commits', async (t) => {
  const f = await fixture(t);
  await git(f.local, 'switch', '-c', 'other');
  await commit(f.local, 'shared.txt', 'other\n');
  await git(f.local, 'switch', 'main');
  await commit(f.local, 'shared.txt', 'main\n');
  const merge = await f.run({ action: 'merge', branch: 'other', ffOnly: false });
  assert.equal(merge.errorCode, 'git_conflict', merge.error);
  const view = await f.scope(() => f.service.view(id));
  assert.deepEqual(view.conflicts, ['shared.txt']);
  assert.equal(view.operation, 'MERGE_HEAD');
  const conflicted = await readFile(join(f.local, 'shared.txt'), 'utf8');
  for (const action of ['pull', 'push']) assert.equal((await f.run({ action })).errorCode, 'git_conflict');
  assert.equal((await f.run({ action: 'commit', message: 'must not commit' })).errorCode, 'git_conflict');
  assert.equal(await readFile(join(f.local, 'shared.txt'), 'utf8'), conflicted);
  await writeFile(join(f.local, 'shared.txt'), 'resolved\n');
  assert.equal((await f.run({ action: 'stage', paths: ['shared.txt'] })).status, 'done');
  assert.equal((await f.run({ action: 'pull' })).errorCode, 'git_operation_in_progress');
  assert.equal((await f.scope(() => f.service.view(id))).conflicts?.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: detached, unborn and rebasing worktrees require explicit recovery before pull or push
 * 协作入口 / Collaborators: `fixture`, `git`, `assert.equal`, `f.run`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.run({ action })).errorCode, 'git_detached_head')`; `assert.equal((await f.run({ action: 'fetch' })).status, 'done')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('detached, unborn and rebasing worktrees require explicit recovery before pull or push', async (t) => {
  const f = await fixture(t);
  await git(f.local, 'checkout', '--detach');
  for (const action of ['pull', 'push'])
    assert.equal((await f.run({ action })).errorCode, 'git_detached_head');
  assert.equal((await f.run({ action: 'fetch' })).status, 'done');
  await git(f.local, 'switch', 'main');
  const linked = join(f.directory, 'linked');
  await git(f.local, 'worktree', 'add', '-b', 'linked', linked);
  f.setDirectory(linked);
  const rebasePath = await git(linked, 'rev-parse', '--git-path', 'rebase-merge');
  await mkdir(resolve(linked, rebasePath), { recursive: true });
  assert.equal((await f.run({ action: 'push' })).errorCode, 'git_operation_in_progress');
  assert.equal((await f.scope(() => f.service.view(id))).operation, 'rebase-merge');
  const empty = join(f.directory, 'empty');
  await git(f.directory, 'init', '--initial-branch=main', empty);
  f.setDirectory(empty);
  assert.equal((await f.run({ action: 'pull' })).errorCode, 'git_unborn_branch');
  const view = await f.scope(() => f.service.view(id));
  assert.equal(view.hasCommits, false);
  assert.deepEqual(view.divergence, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unknown remotes, missing branches, rewritten URLs and unsafe push URLs fail without exposing credentials
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `f.run`, `git`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.run({ action: 'fetch', remote: 'missing' })).errorCode, 'git_remote_missing')`; `assert.equal((await f.run({ action: 'pull', branch: 'missing' })).errorCode, 'git_remote_branch_missing')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('unknown remotes, missing branches, rewritten URLs and unsafe push URLs fail without exposing credentials', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run({ action: 'fetch', remote: 'missing' })).errorCode, 'git_remote_missing');
  assert.equal((await f.run({ action: 'pull', branch: 'missing' })).errorCode, 'git_remote_branch_missing');
  await git(f.local, 'config', 'url.file:///tmp/unsafe.insteadOf', 'https://example.test/');
  assert.equal((await f.run({ action: 'fetch' })).errorCode, 'git_unsafe_remote');
  await git(f.local, 'config', '--remove-section', 'url.file:///tmp/unsafe');
  await git(
    f.local,
    'config',
    'remote.origin.pushurl',
    'https://user:private-token@example.test/repo?token=other-secret',
  );
  assert.equal((await f.run({ action: 'push' })).errorCode, 'git_unsafe_remote');
  const view = await f.scope(() => f.service.view(id));
  assert.doesNotMatch(JSON.stringify(view), /private-token|other-secret/);
  assert.equal(
    redactGitOutput('fatal: https://user:secret@example.test/repo?token=secret'),
    'fatal: https://example.test/repo',
  );
  await git(f.local, 'config', 'remote.origin.pushurl', 'https://example.test/repo');
  await git(f.local, 'config', '--add', 'remote.origin.pushurl', 'https://example.test/other');
  assert.equal((await f.run({ action: 'push' })).errorCode, 'git_ambiguous_remote');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pull rechecks local edits and branch changes made while fetch is running
 * 协作入口 / Collaborators: `fixture`, `git`, `commit`, `f.afterNetwork`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.run({ action: 'pull' })).errorCode, 'git_dirty_worktree')`; `assert.equal(await git(f.local, 'rev-parse', 'HEAD'), head)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('pull rechecks local edits and branch changes made while fetch is running', async (t) => {
  const f = await fixture(t);
  const head = await git(f.local, 'rev-parse', 'HEAD');
  await commit(f.peer, 'shared.txt', 'remote update\n');
  await git(f.peer, 'push');
  f.afterNetwork(async () => {
    await writeFile(join(f.local, 'new.txt'), 'during fetch');
  });
  assert.equal((await f.run({ action: 'pull' })).errorCode, 'git_dirty_worktree');
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), head);
  await rm(join(f.local, 'new.txt'));
  f.afterNetwork(async () => {
    await git(f.local, 'switch', '-c', 'another');
  });
  assert.equal((await f.run({ action: 'pull' })).errorCode, 'git_branch_changed');
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), head);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pull preserves ignored files and rejects a changed original configuration before merging
 * 状态影响 / State effects: `f.commands.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `git`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.run({ action: 'pull' })).errorCode, 'git_pull_blocked')`; `assert.equal(await git(f.local, 'rev-parse', 'HEAD'), head)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('pull preserves ignored files and rejects a changed original configuration before merging', async (t) => {
  const f = await fixture(t);
  const head = await git(f.local, 'rev-parse', 'HEAD');
  await writeFile(join(f.local, '.git', 'info', 'exclude'), 'ignored.txt\n');
  await writeFile(join(f.local, 'ignored.txt'), 'private local work');
  const next = await commit(f.peer, 'ignored.txt', 'remote tracked content');
  await git(f.peer, 'push');
  assert.equal((await f.run({ action: 'pull' })).errorCode, 'git_pull_blocked');
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), head);
  assert.equal(await readFile(join(f.local, 'ignored.txt'), 'utf8'), 'private local work');
  await rm(join(f.local, 'ignored.txt'));
  f.commands.length = 0;
  f.afterNetwork(async () => {
    f.setDirectory(f.peer);
  });
  const pulled = await f.run({ action: 'pull' });
  assert.equal(pulled.status, 'error');
  assert.equal(pulled.errorCode, 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), head);
  assert.equal(await git(f.local, 'rev-parse', 'origin/main'), next);
  assert.ok(f.commands.every((value) => value.command.includes(posix(f.local)) &&
    !value.command.includes(posix(f.peer))));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network and authentication errors are durable, redacted and never automatically retried
 * 协作入口 / Collaborators: `fixture`, `f.beforeNetwork`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.match(job.error!, /Authentication failed/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('network and authentication errors are durable, redacted and never automatically retried', async (t) => {
  const f = await fixture(t);
  let attempts = 0;
  f.beforeNetwork(async () => {
    attempts++;
    throw new Error(
      'Authentication failed for https://user:private-token@example.test/repo?token=other-secret',
    );
  });
  const job = await f.run({ action: 'fetch' });
  assert.equal(job.status, 'error');
  assert.match(job.error!, /Authentication failed/);
  assert.doesNotMatch(JSON.stringify(job), /private-token|other-secret/);
  assert.equal(attempts, 1);
  const res = {
    payload: {} as any,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: network and authentication errors are durable, redacted and never automatically retried
     */
    writeHead() {},
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: network and authentication errors are durable, redacted and never automatically retried
     * 状态影响 / State effects: `this.payload`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `JSON.parse`.
     */
    end(value: string) {
      this.payload = JSON.parse(value);
    },
  };
  await taskRoute.call(
    f.host,
    { method: 'GET' } as IncomingMessage,
    res as unknown as ServerResponse,
    new URL('http://localhost/api/events'),
    async () => ({}),
    new AbortController().signal,
  );
  assert.equal(res.payload.events[0].id, job.id);
  assert.match(res.payload.events[0].message, /Authentication failed/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: accepted Git jobs serialize per project, keep their directory, and cancel through the task endpoint
 * 状态影响 / State effects: `req.method`, `req.headers`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.beforeNetwork`, `Readable.from`, `Buffer.from`.
 * 检查边界 / Checked boundaries: `assert.equal( await f.scope(() => gitRoute.call( f.host, req, res as unknown as ServerResponse, new URL(`http://localhost/api/vms/…`; `assert.equal(res.status, 202)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('accepted Git jobs serialize per project, keep their directory, and cancel through the task endpoint', async (t) => {
  const f = await fixture(t);
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.beforeNetwork(async (_command, signal) => {
    entered();
    await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), { once: true }));
  });
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ status: 0, payload: {} as any, writeHead(status: number) { this.status = stat…`）。
   * Result: Return the branch-computed value (`({ status: 0, payload: {} as any, writeHead(status: number) { this.status = stat…`).
   * 验证场景 / Scenario: accepted Git jobs serialize per project, keep their directory, and cancel through the task endpoint
   */
  const response = () => ({
    status: 0,
    payload: {} as any,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: status: number。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: accepted Git jobs serialize per project, keep their directory, and cancel through the task endpoint
     * 状态影响 / State effects: `this.status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    writeHead(status: number) {
      this.status = status;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: accepted Git jobs serialize per project, keep their directory, and cancel through the task endpoint
     * 状态影响 / State effects: `this.payload`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `JSON.parse`.
     */
    end(value: string) {
      this.payload = JSON.parse(value);
    },
  });
  const req = Readable.from([Buffer.from(JSON.stringify({ action: 'pull' }))]) as IncomingMessage;
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  const res = response();
  const requestAbort = new AbortController();
  assert.equal(
    await f.scope(() =>
      gitRoute.call(
        f.host,
        req,
        res as unknown as ServerResponse,
        new URL(`http://localhost/api/vms/${id}/git?project=${projectId}`),
        async () => ({ action: 'pull' }),
        requestAbort.signal,
      ),
    ),
    true,
  );
  assert.equal(res.status, 202);
  assert.equal(res.payload.projectId, projectId);
  await ready;
  requestAbort.abort(); // Closing the submitting HTTP request does not cancel an accepted background job.
  await assert.rejects(f.start({ action: 'push' }), (error: any) => error.status === 409);
  f.setDirectory(f.peer);
  const job = f.service.jobs.get(res.payload.id)!;
  const cancelled = response();
  await taskRoute.call(
    f.host,
    req,
    cancelled as unknown as ServerResponse,
    new URL(`http://localhost/api/jobs/${job.id}/cancel`),
    async () => ({}),
    new AbortController().signal,
  );
  await f.service.jobs.wait(job.key!);
  assert.equal(job.status, 'cancelled');
  assert.equal(job.errorCode, undefined);
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), await git(f.peer, 'rev-parse', 'HEAD'));
  assert.ok(f.commands.every((value) => value.command.includes(posix(f.local)) &&
    !value.command.includes(posix(f.peer))));
  assert.ok(!f.commands.some((value) => value.command.includes(' merge --ff-only')));
  assert.equal(
    f.commands.find((value) => value.command.includes('GIT_ALLOW_PROTOCOL=https'))!.signal?.aborted,
    true,
  );
});
