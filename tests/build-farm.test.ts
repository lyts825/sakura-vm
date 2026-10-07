/**
 * 模块职责：回归验证模块，围绕 `build-farm` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `build-farm`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: build farm persists a queued build, dispatches to a matching running VM and records the result; build farm uses two nodes concurrently, keeps excess work queued and cancels a running build.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

const root = await mkdtemp(join(tmpdir(), 'sakura-build-farm-test-'));
process.env.SAKURA_DATA_DIR = root;
const { BuildFarm } = await import('../server/build-farm.ts');
const { Jobs } = await import('../server/jobs.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces, projectVersion } = await import('../server/workspaces.ts');
const { ProjectTerminals } = await import('../server/project-terminals.ts');
const { AppError, vmDir } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: predicate: () => boolean。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `Date.now`, `predicate`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(predicate(), 'condition did not become true')`.
 */
const waitFor = async (predicate: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => boolean) => {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 20));
  assert.ok(predicate(), 'condition did not become true');
};
/**
 * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
 * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
 * 输入 / Inputs: name: string; labels: string[] = []。
 * 结果：返回分支计算值（`({ name, command: `printf ${name}`, cwd: '/workspace', labels, timeoutSeconds: 3…`）。
 * Result: Return the branch-computed value (`({ name, command: `printf ${name}`, cwd: '/workspace', labels, timeoutSeconds: 3…`).
 */
const build = (name: string, labels: string[] = []) => ({ name,
  command: `printf ${name}`, cwd: '/workspace', labels, timeoutSeconds: 30 });
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: records: Map<string, { id: string; name: string }>; state: () => string; execute: (...args: any[]) => Promise<any>。
 * 结果：返回分支计算值（`Object.assign(new EventEmitter(), { records, commands, executions, runTask, live…`）。
 * Result: Return the branch-computed value (`Object.assign(new EventEmitter(), { records, commands, executions, runTask, live…`).
 * 协作入口 / Collaborators: `[...records.keys()].map`, `records.keys`, `Object.assign`, `locks.locked.bind`.
 */
function guest(records: Map<string, { id: string; name: string }>, state: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => string,
  execute: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args: any[]。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (...args: any[]) => Promise<any>) {
  const locks = new Machines({} as any, fakeVmNetwork);
  const commands: string[] = [];
  const executions: { project: any; execution: { command: string; environment?: Record<string, string> };
    signal: AbortSignal; expectedLive: unknown }[] = [];
  const live = new Map([...records.keys()].map((id) => [id, {}]));
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _machines; id; project; execution; signal; log; timeout; _agent; _afterCleanup; options。
   * 结果：返回分支计算值（`execute(id, execution.command, timeout, signal, log)`），以 Promise 交付。
   * Result: Return the branch-computed value (`execute(id, execution.command, timeout, signal, log)`) through a Promise.
   * 失败 / Failure: `new AppError('prepared live changed before admission', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `assert.ok`, `live.get`, `executions.push`, `execute`.
   * 检查边界 / Checked boundaries: `assert.ok(options?.expectedLive, 'build runner requires the exact prepared live instance')`.
   */
  const runTask: NonNullable<ConstructorParameters<typeof BuildFarm>[6]> =
    async (_machines, id, project, execution, signal, log, timeout, _agent, _afterCleanup, options) => {
      assert.ok(options?.expectedLive, 'build runner requires the exact prepared live instance');
      if (options.expectedLive !== live.get(id))
        throw new AppError('prepared live changed before admission', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      executions.push({ project, execution, signal, expectedLive: options.expectedLive });
      return execute(id, execution.command, timeout, signal, log);
    };
  return Object.assign(new EventEmitter(), { records,
    commands, executions, runTask,
    live,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`records.get(id)`）。
     * Result: Return the branch-computed value (`records.get(id)`).
     * 协作入口 / Collaborators: `records.get`.
     */
    get: (id: string) => records.get(id), state, locked: locks.locked.bind(locks),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args: any[]。
     * 结果：返回分支计算值（`Promise.resolve({ code: 0, stdout: 'null\n', stderr: '' }) / Promise.resolve({ code: 0, stdout: 'absent\n', stderr: '' })`）。
     * Result: Return the branch-computed value (`Promise.resolve({ code: 0, stdout: 'null\n', stderr: '' }) / Promise.resolve({ code: 0, stdout: 'absent\n', stderr: '' })`).
     * 协作入口 / Collaborators: `commands.push`, `args[1].includes`, `Promise.resolve`.
     */
    exec: (...args: any[]) => {
      commands.push(args[1]);
      if (args[1].includes('project-directory-migrations'))
        return Promise.resolve({ code: 0, stdout: 'null\n', stderr: '' });
      if (args[1].includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS'))
        return Promise.resolve({ code: 0, stdout: 'absent\n', stderr: '' });
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    },
  }) as any;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: build farm persists a queued build, dispatches to a matching running VM and records the result
 * 状态影响 / State effects: `farm`, `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `guest`, `join`, `farm.init`.
 * 检查边界 / Checked boundaries: `assert.equal((saved as { vmId: string }).vmId, vmId)`; `assert.equal(farm.view().tasks[0].status, 'queued')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('build farm persists a queued build, dispatches to a matching running VM and records the result', async () => {
  const vmId = randomUUID();
  const vm = { id: vmId, name: 'builder-1' };
  let status = 'stopped';
  const calls: { id: string; command: string }[] = [];
  const machines = guest(new Map([[vmId, vm]]), () => status,
    async (id: string, command: string, _timeout: number, _signal: AbortSignal,
      output: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: value: string。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      (value: string) => void) => {
      calls.push({ id, command });
      output('compiled\n');
      return { code: 0, stdout: 'compiled\n', stderr: '' };
    });
  const file = join(root, 'farm-one.json');
  let farm = new BuildFarm(machines, file, undefined, undefined,
    new Jobs('farm-one', join(root, 'jobs')), undefined, machines.runTask);
  await farm.init();
  const saved = await farm.action({ operation: 'save-node', node: {
    vmId, slots: 1, labels: ['linux', 'typescript'], enabled: true } });
  assert.equal((saved as { vmId: string }).vmId, vmId);
  const queued = (await farm.action({ operation: 'submit',
    build: build('compile', ['typescript']) })) as { id: string };
  assert.equal(farm.view().tasks[0].status, 'queued');
  assert.equal(calls.length, 0);
  await farm.close();
  farm = new BuildFarm(machines, file, undefined, undefined,
    new Jobs('farm-one', join(root, 'jobs')), undefined, machines.runTask);
  await farm.init();
  try {
    assert.equal(farm.view().tasks[0].id, queued.id);
    status = 'running';
    await waitFor(() => farm.view().tasks[0].status === 'done');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, vmId);
    assert.equal(calls[0].command, 'printf compile');
    assert.equal(machines.executions[0].project.directory, '/workspace');
    assert.equal(farm.view().tasks[0].projectId, 'default');
    assert.equal(farm.view().tasks[0].directory, '/workspace');
    assert.match(farm.view().tasks[0].job?.log || '', /compiled/);
    const another = (await farm.action({ operation: 'submit',
      build: build('second', ['linux']) })) as { id: string };
    await waitFor(() => farm.view().tasks[0].id === another.id &&
      farm.view().tasks[0].status === 'done');
    assert.equal(farm.view().tasks.length, 2);
  } finally { await farm.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: build farm uses two nodes concurrently, keeps excess work queued and cancels a running build
 * 协作入口 / Collaborators: `randomUUID`, `ids.map`, `guest`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(new Set(started).size, 2)`; `assert.equal(farm.view().tasks.filter((task) => task.status === 'queued').length, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('build farm uses two nodes concurrently, keeps excess work queued and cancels a running build', async () => {
  const ids = [randomUUID(), randomUUID()];
  const records = new Map<string, { id: string; name: string }>(
    ids.map((id, index) => [id, { id, name: `builder-${index}` }]));
  const started: string[] = [];
  const releases: Array</**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void> = [];
  const machines = guest(records, () => 'running',
    (id: string, _command: string, _timeout: number, signal: AbortSignal,
      output: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: value: string。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      (value: string) => void) => new Promise((resolve, reject) => {
      started.push(id);
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: build farm uses two nodes concurrently, keeps excess work queued and cancels a running build
       * 协作入口 / Collaborators: `output`, `resolve`.
       */
      const release = () => { output('ok\n'); resolve({ code: 0, stdout: 'ok\n', stderr: '' }); };
      releases.push(release);
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }));
  const farm = new BuildFarm(machines, join(root, 'farm-two.json'), undefined, undefined,
    new Jobs('farm-two', join(root, 'jobs')), undefined, machines.runTask);
  await farm.init();
  try {
    for (const vmId of ids) await farm.action({ operation: 'save-node', node: {
      vmId, slots: 1, labels: ['node'], enabled: true } });
    for (const name of ['one', 'two', 'three'])
      await farm.action({ operation: 'submit', build: build(name, ['node']) });
    await waitFor(() => started.length === 2);
    assert.equal(new Set(started).size, 2);
    assert.equal(farm.view().tasks.filter((task) => task.status === 'queued').length, 1);
    const first = farm.view().tasks.find((task) => task.name === 'one')!;
    await farm.action({ operation: 'cancel', id: first.id });
    await waitFor(() => farm.view().tasks.find((task) => task.id === first.id)?.status === 'cancelled');
    await waitFor(() => started.length === 3);
    for (const release of releases) release();
    await waitFor(() => farm.view().tasks.filter((task) => task.status === 'done').length === 2);
    assert.equal(farm.view().tasks.filter((task) => task.status === 'cancelled').length, 1);
    await assert.rejects(farm.action({ operation: 'retry', id: farm.view().tasks.find((task) =>
      task.status === 'done')!.id }), /只有失败或中断/);
    const retry = await farm.action({ operation: 'retry', id: first.id }) as { retryOf: string };
    assert.equal(retry.retryOf, first.id);
  } finally { await farm.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed guest exit is retained, retry creates a new build, and shutdown does not replay it
 * 状态影响 / State effects: `code`, `farm`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `guest`, `join`, `farm.init`.
 * 检查边界 / Checked boundaries: `assert.match(first.error || '', /退出码 7/)`; `assert.deepEqual(await farm.jobs.result(first.jobId!), { exitCode: 7, vmId, projectId: 'default', directory: '/workspace', project…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('failed guest exit is retained, retry creates a new build, and shutdown does not replay it', async () => {
  const vmId = randomUUID(), vm = { id: vmId, name: 'builder-failure' };
  let code = 7;
  const machines = guest(new Map([[vmId, vm]]), () => 'running',
    async () => ({ code, stdout: '', stderr: 'compile failed' }));
  const file = join(root, 'farm-failure.json');
  let farm = new BuildFarm(machines, file, undefined, undefined,
    new Jobs('farm-failure', join(root, 'jobs')), undefined, machines.runTask);
  await farm.init();
  await farm.action({ operation: 'save-node', node: {
    vmId, slots: 1, labels: [], enabled: true } });
  const original = (await farm.action({ operation: 'submit',
    build: build('compile') })) as { id: string };
  await waitFor(() => farm.view().tasks.find((task) => task.id === original.id)?.status === 'error');
  const first = farm.view().tasks.find((task) => task.id === original.id)!;
  assert.match(first.error || '', /退出码 7/);
  assert.deepEqual(await farm.jobs.result(first.jobId!), {
    exitCode: 7, vmId, projectId: 'default', directory: '/workspace', projectDirectory: '/workspace',
    configVersion: first.configVersion,
    networkIsolation: 'host', stdout: '', stderr: 'compile failed' });
  code = 0;
  const retry = await farm.action({ operation: 'retry', id: original.id }) as { id: string };
  await waitFor(() => farm.view().tasks.find((task) => task.id === retry.id)?.status === 'done');
  await farm.close();
  farm = new BuildFarm(machines, file, undefined, undefined,
    new Jobs('farm-failure', join(root, 'jobs')), undefined, machines.runTask);
  await farm.init();
  try {
    assert.equal(farm.view().tasks.find((task) => task.id === original.id)?.status, 'error');
    assert.equal(farm.view().tasks.find((task) => task.id === retry.id)?.status, 'done');
    assert.equal(farm.view().tasks.length, 2);
  } finally { await farm.close(); }
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: execute: (...args: any[]) => Promise<any>。
 * 结果：返回受控对象，公开字段包括 `vmId, file, machines, workspaces, terminals, alpha, beta, create, run`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `vmId, file, machines, workspaces, terminals, alpha, beta, create, run`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `join`, `guest`, `mkdir`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function projectFixture(execute: /**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: args: any[]。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(...args: any[]) => Promise<any>) {
  const vmId = randomUUID(), file = join(root, vmId + '-farm.json');
  let status = 'stopped';
  const machines = guest(new Map([[vmId, { id: vmId, name: 'private-builder' }]]), () => status, execute);
  await mkdir(vmDir(vmId), { recursive: true });
  const workspaces = new Workspaces(machines, { secrets: {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; references: Record<string, string>。
     * 结果：返回分支计算值（`references?.TOKEN ? { TOKEN: 'private-farm-token' } : {}`），以 Promise 交付。
     * Result: Return the branch-computed value (`references?.TOKEN ? { TOKEN: 'private-farm-token' } : {}`) through a Promise.
     */
    resolve: async (_id: string, references: Record<string, string>) =>
      references?.TOKEN ? { TOKEN: 'private-farm-token' } : {},
  } as any });
  const alpha = (await workspaces.projects.create(vmId, 'Private', async () => {
    await workspaces.save(vmId, { directory: '/workspace/private', networkIsolation: 'private',
      environment: { BUILD_SCOPE: 'alpha' }, secrets: { TOKEN: 'build-key' } });
  })).active;
  const beta = (await workspaces.projects.create(vmId, 'Other', async () => {
    await workspaces.save(vmId, { directory: '/workspace/other' });
  })).active;
  await workspaces.projects.update(vmId, alpha);
  const terminals = new ProjectTerminals(machines, workspaces);
  /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`new BuildFarm(machines, file, undefined, undefined, new Jobs('farm-' + vmId, joi…`）。
   * Result: Return the branch-computed value (`new BuildFarm(machines, file, undefined, undefined, new Jobs('farm-' + vmId, joi…`).
   * 协作入口 / Collaborators: `join`.
   */
  const create = () => new BuildFarm(machines, file, undefined, undefined,
    new Jobs('farm-' + vmId, join(root, vmId + '-jobs')), terminals, machines.runTask);
  return { vmId, file, machines, workspaces, terminals, alpha, beta, create,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    run: () => { status = 'running'; }, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `terminals.close`, `workspaces.close`.
     */
    close: async () => {
      await terminals.close(); await workspaces.close();
    } };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a queued build keeps its node project across restart and activity changes, and redacts split secret logs
 * 状态影响 / State effects: `farm`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `projectFixture`, `f.create`, `farm.init`, `farm.action`.
 * 检查边界 / Checked boundaries: `assert.equal(node.projectId, f.alpha)`; `assert.equal(task.projectId, f.alpha)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a queued build keeps its node project across restart and activity changes, and redacts split secret logs', async () => {
  const f = await projectFixture(async (_id, _command, _timeout, _signal, log) => {
    log('private-'); log('farm-token\ncompiled');
    return { code: 0, stdout: 'private-farm-token\ncompiled', stderr: 'private-farm-token' };
  });
  let farm = f.create();
  try {
    await farm.init();
    const node = await farm.action({ operation: 'save-node', node: {
      vmId: f.vmId, slots: 1, labels: [], enabled: true } }) as { projectId: string };
    assert.equal(node.projectId, f.alpha);
    await farm.action({ operation: 'submit', build: { name: 'Scoped',
      command: 'printf "$TOKEN"', labels: [], timeoutSeconds: 30 } });
    await farm.close();
    await f.workspaces.projects.update(f.vmId, f.beta);
    farm = f.create();
    await farm.init(); f.run();
    await waitFor(() => farm.view().tasks[0].status === 'done');
    const task = farm.view().tasks[0];
    assert.equal(task.projectId, f.alpha);
    assert.equal(task.directory, '/workspace/private');
    assert.equal(task.networkIsolation, 'private');
    assert.equal(task.job?.projectId, f.alpha);
    const { project, execution } = f.machines.executions[0];
    assert.equal(project._workspace, f.alpha);
    assert.equal(project.directory, '/workspace/private');
    assert.equal(project.networkIsolation, 'private');
    assert.deepEqual(execution.environment, { BUILD_SCOPE: 'alpha', TOKEN: 'private-farm-token' });
    assert.equal(execution.command, 'printf "$TOKEN"');
    assert.doesNotMatch(f.machines.commands.join('\n'), /private-farm-token|printf "\$TOKEN"|export BUILD_SCOPE=/);
    const result = await farm.jobs.result(task.jobId!);
    assert.match(result.stdout, /私密配置已隐藏/);
    assert.doesNotMatch(JSON.stringify({ task, result }), /private-farm-token/);
    assert.doesNotMatch(await readFile(f.file, 'utf8'), /private-farm-token/);
  } finally { await farm.close(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: two slots on one private node stay concurrent and guard project edits until task cancellation finishes
 * 协作入口 / Collaborators: `projectFixture`, `f.create`, `farm.init`, `farm.action`.
 * 检查边界 / Checked boundaries: `assert.equal(active, 2)`; `assert.equal(peak, 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('two slots on one private node stay concurrent and guard project edits until task cancellation finishes', async () => {
  let active = 0, peak = 0;
  const releases: Array</**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void> = [];
  const f = await projectFixture(async (_id, _command, _timeout, signal) => {
    active++; peak = Math.max(peak, active);
    try {
      await new Promise<void>((done, fail) => {
        releases.push(done);
        if (signal.aborted) fail(signal.reason);
        else signal.addEventListener('abort', () => fail(signal.reason), { once: true });
      });
      return { code: 0, stdout: 'compiled', stderr: '' };
    } finally { active--; }
  });
  const farm = f.create();
  try {
    await farm.init();
    await farm.action({ operation: 'save-node', node: {
      vmId: f.vmId, projectId: f.alpha, slots: 2, labels: [], enabled: true } });
    for (const name of ['one', 'two', 'three']) await farm.action({ operation: 'submit', build: {
      name, command: 'sleep 600', labels: [], timeoutSeconds: 30 } });
    f.run();
    await waitFor(() => releases.length === 2);
    assert.equal(active, 2); assert.equal(peak, 2);
    await f.workspaces.projects.with(f.vmId, f.alpha, async () => {
      const project = await f.workspaces.config(f.vmId);
      await assert.rejects(f.workspaces.save(f.vmId, { ...project, networkIsolation: 'host' }), /终端|命令/);
    });
    await assert.rejects(farm.action({ operation: 'save-node', node: {
      vmId: f.vmId, projectId: f.beta, slots: 2, labels: [], enabled: true } }), /执行构建/);
    const first = farm.view().tasks.find((task) => task.name === 'one')!;
    await farm.action({ operation: 'cancel', id: first.id });
    await waitFor(() => releases.length === 3);
    assert.equal(peak, 2);
    assert.equal(f.machines.executions[0].signal.aborted, true);
    assert.equal(f.machines.executions[1].signal.aborted, false);
    for (const release of releases) release();
    await waitFor(() => farm.view().tasks.filter((task) => task.status === 'done').length === 2);
    assert.equal(farm.view().tasks.find((task) => task.id === first.id)?.status, 'cancelled');
    await f.workspaces.projects.with(f.vmId, f.alpha, async () => {
      const project = await f.workspaces.config(f.vmId);
      await f.workspaces.save(f.vmId, { ...project, networkIsolation: 'host' });
    });
  } finally { await farm.close(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: outside directories and missing node projects reject builds without running them in the default network
 * 协作入口 / Collaborators: `projectFixture`, `f.create`, `farm.init`, `farm.action`.
 * 检查边界 / Checked boundaries: `assert.rejects(farm.action({ operation: 'save-node', node: { vmId: f.vmId, projectId: 'ffffffffffffffff', slots: 1, labels: [], en…`; `assert.match(farm.view().tasks[0].error || '', /项目目录内/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('outside directories and missing node projects reject builds without running them in the default network', async () => {
  const f = await projectFixture(async () => { throw new Error('must not execute'); });
  const farm = f.create();
  try {
    await farm.init();
    await farm.action({ operation: 'save-node', node: {
      vmId: f.vmId, projectId: f.alpha, slots: 1, labels: [], enabled: true } });
    await assert.rejects(farm.action({ operation: 'save-node', node: {
      vmId: f.vmId, projectId: 'ffffffffffffffff', slots: 1, labels: [], enabled: true } }), /项目不存在/);
    await farm.action({ operation: 'submit', build: build('outside') });
    f.run();
    await waitFor(() => farm.view().tasks[0].status === 'error');
    assert.match(farm.view().tasks[0].error || '', /项目目录内/);
    const index = await f.workspaces.projects.list(f.vmId);
    await writeFile(join(vmDir(f.vmId), 'projects.json'), JSON.stringify({ ...index,
      active: f.beta, projects: index.projects.filter((project) => project.id !== f.alpha) }));
    await farm.action({ operation: 'submit', build: { name: 'Deleted project',
      command: 'true', labels: [], timeoutSeconds: 30 } });
    await waitFor(() => farm.view().tasks[0].status === 'error');
    assert.match(farm.view().tasks[0].error || '', /项目不存在/);
    assert.equal(f.machines.executions.length, 0);
  } finally { await farm.close(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy node records bind once to their saved active project without replacing valid bindings later
 * 状态影响 / State effects: `farm`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `projectFixture`, `writeFile`, `JSON.stringify`, `f.create`.
 * 检查边界 / Checked boundaries: `assert.equal(farm.view().nodes[0].projectId, f.alpha)`; `assert.equal(JSON.parse(await readFile(f.file, 'utf8')).nodes[0].projectId, f.alpha)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('legacy node records bind once to their saved active project without replacing valid bindings later', async () => {
  const f = await projectFixture(async () => ({ code: 0, stdout: '', stderr: '' }));
  const legacy = { version: 1, nodes: [{ vmId: f.vmId, slots: 1, labels: [], enabled: true }], tasks: [] };
  await writeFile(f.file, JSON.stringify(legacy));
  let farm = f.create();
  try {
    await farm.init();
    assert.equal(farm.view().nodes[0].projectId, f.alpha);
    assert.equal(JSON.parse(await readFile(f.file, 'utf8')).nodes[0].projectId, f.alpha);
    await farm.close();
    await f.workspaces.projects.update(f.vmId, f.beta);
    farm = f.create(); await farm.init();
    assert.equal(farm.view().nodes[0].projectId, f.alpha);
    const projects = await farm.projects(f.vmId);
    assert.equal(projects.vmId, f.vmId);
    assert.equal(projects.active, f.beta);
  } finally { await farm.close(); await f.close(); }
});

for (const base of ['/workspace/private', '/opt/projects/private', '/srv/projects/private']) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `projectFixture`, `f.create`, `f.workspaces.projects.with`, `farm.init`.
   * 检查边界 / Checked boundaries: `assert.rejects(farm.action({ operation: 'submit', build: { name: 'invalid', command: 'true', cwd, labels: [], timeoutSeconds: 30 }…`; `assert.equal(project.directory, base, 'identity remains bound to the original saved directory')`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test('build cwd under ' + base + ' changes only the protected project body', async () => {
    const f = await projectFixture(async () => ({ code: 0, stdout: 'ok', stderr: '' }));
    const farm = f.create();
    try {
      await f.workspaces.projects.with(f.vmId, f.alpha, async () => {
        const project = await f.workspaces.config(f.vmId);
        await f.workspaces.save(f.vmId, { ...project, directory: base });
      });
      await farm.init();
      await farm.action({ operation: 'save-node', node: {
        vmId: f.vmId, projectId: f.alpha, slots: 1, labels: [], enabled: true } });
      for (const cwd of [base + '/../escape', base + '/./sub'])
        await assert.rejects(farm.action({ operation: 'submit', build: {
          name: 'invalid', command: 'true', cwd, labels: [], timeoutSeconds: 30 } }), /点路径/);
      const command = 'false; printf "$TOKEN"; true';
      const cwd = base + '/build-output';
      await farm.action({ operation: 'submit', build: { name: 'nested', command, cwd, labels: [], timeoutSeconds: 30 } });
      f.run();
      await waitFor(() => farm.view().tasks[0].status === 'done');
      const { project, execution } = f.machines.executions[0], task = farm.view().tasks[0];
      assert.equal(project.directory, base, 'identity remains bound to the original saved directory');
      assert.equal(execution.command, "cd './build-output' || exit 72\n" + command);
      assert.equal(execution.environment.TOKEN, 'private-farm-token');
      assert.equal(task.directory, cwd); assert.equal(task.projectDirectory, base);
      assert.match(task.configVersion!, /^[a-f0-9]{64}$/);
      assert.doesNotMatch(f.machines.commands.join('\n'), /false;|printf "\$TOKEN"|private-farm-token/);
    } finally { await farm.close(); await f.close(); }
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: build preparation resolves its captured environment instead of rereading a concurrently saved project
 * 状态影响 / State effects: `f.terminals.prepare`, `f.workspaces.resolvedConfig`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `projectFixture`, `f.create`, `f.terminals.prepare.bind`, `farm.init`.
 * 检查边界 / Checked boundaries: `assert.equal(project.environment.BUILD_SCOPE, 'alpha')`; `assert.equal(execution.environment.BUILD_SCOPE, 'alpha')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('build preparation resolves its captured environment instead of rereading a concurrently saved project', async () => {
  const f = await projectFixture(async () => ({ code: 0, stdout: '', stderr: '' })), farm = f.create();
  const prepare = f.terminals.prepare.bind(f.terminals);
  let capturedVersion: string | undefined;
  f.terminals.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`prepared`），以 Promise 交付。
   * Result: Return the branch-computed value (`prepared`) through a Promise.
   * 验证场景 / Scenario: build preparation resolves its captured environment instead of rereading a concurrently saved project
   * 状态影响 / State effects: `capturedVersion`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `prepare`, `f.workspaces.projects.with`.
   */
  async (...args) => {
    const prepared = await prepare(...args);
    capturedVersion = prepared.captured!.configVersion;
    await f.workspaces.projects.with(f.vmId, f.alpha, async () => {
      const previous = await f.workspaces.config(f.vmId);
      await f.workspaces.save(f.vmId, { ...previous, environment: { BUILD_SCOPE: 'changed' } });
    });
    return prepared;
  };
  f.workspaces.resolvedConfig = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: build preparation resolves its captured environment instead of rereading a concurrently saved project
   * 失败 / Failure: `new Error('captured project must not be reread')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw new Error('captured project must not be reread'); };
  try {
    await farm.init();
    await farm.action({ operation: 'save-node', node: {
      vmId: f.vmId, projectId: f.alpha, slots: 1, labels: [], enabled: true } });
    await farm.action({ operation: 'submit', build: { name: 'snapshot', command: 'true', labels: [], timeoutSeconds: 30 } });
    f.run();
    await waitFor(() => farm.view().tasks[0].status === 'done');
    const { project, execution } = f.machines.executions[0];
    assert.equal(project.environment.BUILD_SCOPE, 'alpha');
    assert.equal(execution.environment.BUILD_SCOPE, 'alpha');
    assert.equal(execution.environment.TOKEN, 'private-farm-token');
    assert.equal(farm.view().tasks[0].configVersion, capturedVersion);
    await f.workspaces.projects.with(f.vmId, f.alpha, async () => {
      const current = await f.workspaces.config(f.vmId);
      assert.equal(current.environment?.BUILD_SCOPE, 'changed');
      assert.notEqual(projectVersion(current), capturedVersion);
    });
  } finally { await farm.close(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a live replacement during asynchronous secret resolution cannot execute the previous preparation on a new instance
 * 状态影响 / State effects: `f.workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `projectFixture`, `f.create`, `f.workspaces.resolveProject.bind`, `f.machines.live.get`.
 * 检查边界 / Checked boundaries: `assert.equal(farm.view().tasks[0].errorCode, 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.machines.executions.length, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a live replacement during asynchronous secret resolution cannot execute the previous preparation on a new instance', async () => {
  const f = await projectFixture(async () => { throw new Error('old preparation must not execute'); }), farm = f.create();
  const resolve = f.workspaces.resolveProject.bind(f.workspaces);
  const expected = f.machines.live.get(f.vmId);
  f.workspaces.resolveProject = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: a live replacement during asynchronous secret resolution cannot execute the previous preparation on a new instance
   * 协作入口 / Collaborators: `resolve`, `f.machines.live.set`.
   */
  async (...args) => {
    const result = await resolve(...args);
    await new Promise(done => setImmediate(done));
    f.machines.live.set(f.vmId, {});
    return result;
  };
  try {
    await farm.init();
    await farm.action({ operation: 'save-node', node: {
      vmId: f.vmId, projectId: f.alpha, slots: 1, labels: [], enabled: true } });
    await farm.action({ operation: 'submit', build: { name: 'replaced', command: 'true', labels: [], timeoutSeconds: 30 } });
    f.run();
    await waitFor(() => farm.view().tasks[0].status === 'error');
    assert.equal(farm.view().tasks[0].errorCode, 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.machines.executions.length, 0);
    assert.notEqual(f.machines.live.get(f.vmId), expected);
  } finally { await farm.close(); await f.close(); }
});

for (const shutdown of [false, true]) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `farm.jobs.start`, `closing`, `farm`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `projectFixture`, `f.create`, `farm.jobs.start.bind`, `farm.init`.
   * 检查边界 / Checked boundaries: `assert.equal(farm.view().tasks[0].job?.status, 'running')`; `assert.equal(errorStatus, 503, 'cleanup refusal must preserve the original AppError HTTP status')`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test((shutdown ? 'shutdown' : 'cancellation') + ' preserves unconfirmed cleanup errors and the task lease until cleanup finishes', async () => {
    let started!: /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
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
    () => void, aborted!: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const cleanup = new Promise<void>(resolve => { finish = resolve; });
    const cancelled = new Promise<void>(resolve => { aborted = resolve; });
    const f = await projectFixture(async (_id, _command, _timeout, signal, log) => {
      started();
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => { aborted(); resolve(); }, { once: true });
      });
      await cleanup;
      log('cleanup private-farm-token\n');
      throw new AppError('private-farm-token scope cleanup not confirmed', 503, 'GUEST_TASK_CLEANUP_FAILED');
    });
    let farm = f.create(), closing: Promise<void> | undefined;
    let errorStatus: number | undefined;
    const start = farm.jobs.start.bind(farm.jobs);
    farm.jobs.start = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: key; work; meta。
     * 结果：返回分支计算值（`start(key, async (...args) => { try { await work(...args); } catch (error) { if …`）。
     * Result: Return the branch-computed value (`start(key, async (...args) => { try { await work(...args); } catch (error) { if …`).
     * 协作入口 / Collaborators: `start`.
     */
    (key, work, meta) => start(key, async (...args) => {
      try { await work(...args); }
      catch (error) { if (error instanceof AppError) errorStatus = error.status; throw error; }
    }, meta);
    try {
      await farm.init();
      await farm.action({ operation: 'save-node', node: {
        vmId: f.vmId, projectId: f.alpha, slots: 1, labels: [], enabled: true } });
      await farm.action({ operation: 'submit', build: { name: 'cleanup', command: 'sleep 600', labels: [], timeoutSeconds: 30 } });
      f.run();
      // The scheduler deliberately uses unreferenced timers. Keep a bounded
      // readiness check until it dispatches, rather than waiting on an idle promise.
      await waitFor(() => f.machines.executions.length === 1);
      await entered;
      if (shutdown) closing = farm.close();
      else await farm.action({ operation: 'cancel', id: farm.view().tasks[0].id });
      await cancelled;
      await f.workspaces.projects.with(f.vmId, f.alpha, async () => {
        const project = await f.workspaces.config(f.vmId);
        await assert.rejects(f.workspaces.save(f.vmId, { ...project, networkIsolation: 'host' }), /终端或命令/);
      });
      assert.equal(farm.view().tasks[0].job?.status, 'running');
      finish();
      if (closing) await closing;
      await waitFor(() => farm.view().tasks[0].status === 'error');
      const failed = farm.view().tasks[0];
      assert.equal(errorStatus, 503, 'cleanup refusal must preserve the original AppError HTTP status');
      assert.equal(failed.errorCode, 'GUEST_TASK_CLEANUP_FAILED');
      assert.equal(failed.job?.errorCode, 'GUEST_TASK_CLEANUP_FAILED');
      assert.match(failed.error || '', /scope cleanup not confirmed/);
      assert.doesNotMatch(JSON.stringify(failed), /private-farm-token/);
      await farm.close();
      farm = f.create(); await farm.init();
      const reopened = farm.view().tasks[0];
      assert.equal(reopened.status, 'error'); assert.equal(reopened.errorCode, 'GUEST_TASK_CLEANUP_FAILED');
      assert.doesNotMatch(await readFile(f.file, 'utf8'), /private-farm-token/);
    } finally { finish(); await closing; await farm.close(); await f.close(); }
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: farm reload reconciles an unfinished row against the actual terminal Job instead of replaying or dropping its error code
 * 协作入口 / Collaborators: `randomUUID`, `guest`, `join`, `jobs.start`.
 * 检查边界 / Checked boundaries: `assert.equal(farm.view().tasks[0].status, 'error')`; `assert.equal(farm.view().tasks[0].errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('farm reload reconciles an unfinished row against the actual terminal Job instead of replaying or dropping its error code', async () => {
  const vmId = randomUUID(), machines = guest(new Map([[vmId, { id: vmId, name: 'builder' }]]), () => 'stopped',
    async () => { throw new Error('must not run during reconciliation'); });
  const jobs = new Jobs('farm-reconcile', join(root, 'jobs')), taskId = randomUUID();
  const job = jobs.start(taskId, async () => { throw new AppError('receipt cleanup not confirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'); });
  await jobs.wait(taskId);
  const file = join(root, 'farm-reconcile.json');
  await writeFile(file, JSON.stringify({ version: 1, nodes: [], tasks: [{
    ...build('reconcile'), id: taskId, status: 'running', vmId, jobId: job.id, createdAt: new Date().toISOString() }] }));
  const farm = new BuildFarm(machines, file, undefined, undefined, jobs, undefined, machines.runTask);
  try {
    await farm.init();
    assert.equal(farm.view().tasks[0].status, 'error');
    assert.equal(farm.view().tasks[0].errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    assert.equal(machines.executions.length, 0);
  } finally { await farm.close(); }
});
