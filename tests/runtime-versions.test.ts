/**
 * 模块职责：回归验证模块，围绕 `runtime-versions` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `runtime-versions`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: GET is host-only before and after thousands of polls; stale samples never launch a task; sample cache is bounded, separates scopes, and a new module does not reuse a previous ticket.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Machines as MachinesType } from '../server/machines.ts';
import type { Project } from '../server/workspaces.ts';
import type { ProjectIdentityExecution } from '../server/project-identity.ts';

const base = resolve('.data/runtime-identity-unit-temp');
await mkdir(base, { recursive: true });
const directory = await mkdtemp(join(base, 'sakura-runtime-unit-'));
process.env.SAKURA_DATA_DIR = directory;
const { runtimeProbeCommand, parseRuntimeProbe } = await import('../server/runtime-probe.ts');
const { runtimeInstallCommand, runtimeInstallSetup, parseRuntimeInstall, parseRuntimeInstallRecovery } = await import('../server/runtime-install.ts');
const { RuntimeVersions } = await import('../server/runtime-versions.ts');
const { Workspaces, projectSchema, projectVersion } = await import('../server/workspaces.ts');
const { Machines } = await import('../server/machines.ts');
const { AppError, vmDir } = await import('../server/model.ts');
const { Jobs } = await import('../server/jobs.ts');
const { runtimeEnvironment } = await import('../server/runtime-config.ts');
after(async () => { assert.equal(dirname(resolve(directory)), base); await rm(directory, { recursive: true, force: true }); });

const bootId = randomUUID();
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: actual = { node: '22.12.0', python: '3.12.1' }; declared = {}。
 * 结果：返回分支计算值（`({ code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true, bootId, a…`）。
 * Result: Return the branch-computed value (`({ code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true, bootId, a…`).
 * 协作入口 / Collaborators: `JSON.stringify`.
 */
const sample = (actual = { node: '22.12.0', python: '3.12.1' }, declared = {}) => ({ code: 0, stderr: '',
  stdout: JSON.stringify({ version: 1, ok: true, bootId, actual, declared }) });
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: phase: 'prepared' | 'ready'; installId: string = randomUUID(); tool: 'node' | 'python' = 'node'; version = '22.12.0'。
 * 结果：返回分支计算值（`({ code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true, result: {…`）。
 * Result: Return the branch-computed value (`({ code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true, result: {…`).
 * 协作入口 / Collaborators: `JSON.stringify`, `'a'.repeat`.
 */
const receipt = (phase: 'prepared' | 'ready', installId: string = randomUUID(), tool: 'node' | 'python' = 'node', version = '22.12.0') => ({ code: 0, stderr: '',
  stdout: JSON.stringify({ version: 1, ok: true, result: { version: 1, tool, architecture: 'x86_64', requestedVersion: version,
    phase, installId, directoryDevice: '1', directoryInode: '2', executableDevice: '1', executableInode: '3', executableSha256: 'a'.repeat(64) } }) });
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, resolve, reject`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, resolve, reject`; the actual branch determines its shape.
 */
function deferred<T>() {
  let resolve!: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: value: T。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (value: T) => void, reject!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: reason: unknown。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: initial: Partial<Project> = {}。
 * 结果：返回受控对象，公开字段包括 `id, live, machines, workspaces, runtime, calls, tasks, configuration, replace`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, live, machines, workspaces, runtime, calls, tasks, configuration, replace`; the actual branch determines its shape.
 * 状态影响 / State effects: `runtime.jobs`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `projectSchema.parse`, `Date.now`, `Object.assign`.
 */
function fixture(initial: Partial<Project> = {}) {
  const id = randomUUID(), live = { status: 'running', startedAt: 'one' }, calls: string[] = [], tasks: ProjectIdentityExecution[] = [];
  let configuration: Project = projectSchema.parse({ directory: '/srv/projects/one', ...initial });
  let scope = 'default', locked = false, saves = 0, now = Date.now();
  const machines = Object.assign(new EventEmitter(), { live: new Map([[id, live]]), records: new Map([[id, { template: 'none' }]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ name: 'owned', distro: 'debian', template: 'none' })`）。
     * Result: Return the branch-computed value (`({ name: 'owned', distro: 'debian', template: 'none' })`).
     */
    get: () => ({ name: 'owned', distro: 'debian', template: 'none' }), /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`machines.live.get(id)?.status || 'stopped'`）。
     * Result: Return the branch-computed value (`machines.live.get(id)?.status || 'stopped'`).
     * 协作入口 / Collaborators: `machines.live.get`.
     */
    state: () => machines.live.get(id)?.status || 'stopped',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回分支计算值（`command.includes('SAKURA_RUNTIME_INSTALL') ? receipt('ready') : { code: 0, stdou…`），以 Promise 交付。
     * Result: Return the branch-computed value (`command.includes('SAKURA_RUNTIME_INSTALL') ? receipt('ready') : { code: 0, stdou…`) through a Promise.
     * 协作入口 / Collaborators: `calls.push`, `command.includes`, `receipt`.
     */
    exec: async (_id: string, command: string) => { calls.push(command); return command.includes('SAKURA_RUNTIME_INSTALL') ? receipt('ready') : { code: 0, stdout: bootId, stderr: '' }; },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('GET must not read guest files')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    readGuestFile: async () => { throw new Error('GET must not read guest files'); },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id: string; action: () => Promise<T>。
     * 结果：返回分支计算值（`await action()`），以 Promise 交付。
     * Result: Return the branch-computed value (`await action()`) through a Promise.
     * 状态影响 / State effects: `locked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.equal`, `action`.
     * 检查边界 / Checked boundaries: `assert.equal(locked, false, 'VM locks must not reenter')`.
     */
    locked: async <T>(_id: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<T>) => { assert.equal(locked, false, 'VM locks must not reenter'); locked = true; try { return await action(); } finally { locked = false; } },
  }) as unknown as MachinesType;
  const workspaces = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`configuration`），以 Promise 交付。
     * Result: Return the branch-computed value (`configuration`) through a Promise.
     */
    config: async () => configuration,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; project: Project。
     * 结果：返回分支计算值（`({ ...project, environment: { ...project.environment, ...runtimeEnvironment(proj…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ...project, environment: { ...project.environment, ...runtimeEnvironment(proj…`) through a Promise.
     * 协作入口 / Collaborators: `runtimeEnvironment`.
     */
    resolveProject: async (_id: string, project: Project) => ({ ...project, environment: {
      ...project.environment, ...runtimeEnvironment(project.runtimes, project.environment?.PATH) } }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({})`），以 Promise 交付。
     * Result: Return the branch-computed value (`({})`) through a Promise.
     */
    networkEnvironment: async () => ({}), /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`() => {}`）。
     * Result: Return the branch-computed value (`() => {}`).
     */
    onConfigChange: () => () => {},
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _id: string; project: Project; _allowed: unknown; version: string; commit: () => void。
     * 结果：返回分支计算值（`machines.locked(id, async () => { commit?.(); assert.equal(version, projectVersi…`），以 Promise 交付。
     * Result: Return the branch-computed value (`machines.locked(id, async () => { commit?.(); assert.equal(version, projectVersi…`) through a Promise.
     * 协作入口 / Collaborators: `machines.locked`.
     */
    save: async (_id: string, project: Project, _allowed: unknown, version?: string, commit?: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void) => machines.locked(id, async () => {
      commit?.(); assert.equal(version, projectVersion(configuration)); ++saves;
      configuration = projectSchema.parse(project); return configuration;
    }),
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
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`scope === 'default' ? id : id + ':' + scope`）。
     * Result: Return the branch-computed value (`scope === 'default' ? id : id + ':' + scope`).
     */
    key: () => scope === 'default' ? id : id + ':' + scope },
  } as unknown as InstanceType<typeof Workspaces>;
  const runtime = new RuntimeVersions(machines, workspaces, { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`now`）。
   * Result: Return the branch-computed value (`now`).
   */
  now: () => now, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _machine; _id; _project; execution。
   * 结果：返回分支计算值（`sample()`），以 Promise 交付。
   * Result: Return the branch-computed value (`sample()`) through a Promise.
   * 协作入口 / Collaborators: `assert.equal`, `tasks.push`, `sample`.
   * 检查边界 / Checked boundaries: `assert.equal(locked, true)`.
   */
  runTask: async (_machine, _id, _project, execution) => {
    assert.equal(locked, true); tasks.push(execution); return sample();
  } });
  runtime.jobs = new Jobs();
  return { id, live, machines, workspaces, runtime, calls, tasks,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`configuration`）。
     * Result: Return the branch-computed value (`configuration`).
     */
    configuration: () => configuration, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: project: Partial<Project>。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `configuration`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `projectSchema.parse`.
     */
    replace: (project: Partial<Project>) => { configuration = projectSchema.parse({ ...configuration, ...project }); },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `scope`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    scope: (value: string) => { scope = value; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: number。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    advance: (value: number) => { now += value; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`saves`）。
     * Result: Return the branch-computed value (`saves`).
     */
    saves: () => saves,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: NonNullable<ConstructorParameters<typeof RuntimeVersions>[2]>['ru…。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `(runtime as any).options.runTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    runTask: (value: NonNullable<ConstructorParameters<typeof RuntimeVersions>[2]>['runTask']) => { (runtime as any).options.runTask = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: NonNullable<ConstructorParameters<typeof RuntimeVersions>[2]>['ru…。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `(runtime as any).options.runInstallTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    runInstallTask: (value: NonNullable<ConstructorParameters<typeof RuntimeVersions>[2]>['runInstallTask']) => { (runtime as any).options.runInstallTask = value; },
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GET is host-only before and after thousands of polls; stale samples never launch a task
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `f.runtime.view`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.runtime.view(f.id)).probe.state, 'unprobed')`; `assert.deepEqual((await f.runtime.view(f.id)).mismatches, [])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('GET is host-only before and after thousands of polls; stale samples never launch a task', async () => {
  const f = fixture({ environment: { PATH: '/srv/projects/one/bin', TOKEN: 'owned-private-body' } });
  try {
    assert.equal((await f.runtime.view(f.id)).probe.state, 'unprobed');
    assert.deepEqual((await f.runtime.view(f.id)).mismatches, []);
    for (let index = 0; index < 2200; index++) await f.runtime.view(f.id);
    assert.equal(f.calls.length, 0); assert.equal(f.tasks.length, 0);
    const result = await f.runtime.probe(f.id);
    assert.equal(result.probe.state, 'cached'); assert.equal(result.probe.bootId, bootId);
    assert.equal(f.tasks.length, 1); assert.equal(f.calls.length, 0);
    assert.equal(f.tasks[0].environment?.TOKEN, 'owned-private-body');
    assert.equal(f.tasks[0].environment?.PATH, '/srv/projects/one/bin');
    assert.ok(!JSON.stringify(result).includes('owned-private-body'));
    for (let index = 0; index < 2200; index++) await f.runtime.view(f.id);
    assert.equal(f.tasks.length, 1);
    f.advance(300001); assert.equal((await f.runtime.view(f.id)).probe.state, 'stale');
    f.machines.live.set(f.id, { ...f.live } as any);
    assert.equal((await f.runtime.view(f.id)).probe.state, 'stale');
    assert.equal(f.tasks.length, 1);
  } finally { await f.runtime.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: sample cache is bounded, separates scopes, and a new module does not reuse a previous ticket
 * 状态影响 / State effects: `replacement.jobs`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.scope`, `index.toString(16).padStart`, `index.toString`.
 * 检查边界 / Checked boundaries: `assert.equal((f.runtime as any).samples.size, 256)`; `assert.equal((await f.runtime.view(f.id)).probe.state, 'unprobed')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('sample cache is bounded, separates scopes, and a new module does not reuse a previous ticket', async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 260; index++) { f.scope(index.toString(16).padStart(16, '0')); await f.runtime.probe(f.id); }
    assert.equal((f.runtime as any).samples.size, 256);
    f.scope('0000000000000000'); assert.equal((await f.runtime.view(f.id)).probe.state, 'unprobed');
    f.scope('0000000000000103'); assert.equal((await f.runtime.view(f.id)).probe.state, 'cached');
    assert.equal(f.tasks.length, 260);
    await f.runtime.close();
    const replacement = new RuntimeVersions(f.machines, f.workspaces, { /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`sample()`），以 Promise 交付。
     * Result: Return the branch-computed value (`sample()`) through a Promise.
     * 验证场景 / Scenario: sample cache is bounded, separates scopes, and a new module does not reuse a previous ticket
     * 协作入口 / Collaborators: `f.tasks.push`, `sample`.
     */
    runTask: async () => { f.tasks.push({ command: 'new-ticket' }); return sample(); } });
    replacement.jobs = new Jobs();
    try { await replacement.probe(f.id); assert.equal(f.tasks.length, 261); }
    finally { await replacement.close(); }
  } finally { await f.runtime.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: selected pins require a read-only ready receipt before the project task and compare exact versions
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.runtime.select`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(f.calls.length, 1)`; `assert.match(f.calls[0], /"operation\\":\\"verify/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('selected pins require a read-only ready receipt before the project task and compare exact versions', async () => {
  const f = fixture();
  try {
    await f.runtime.select(f.id, { node: '22.12.0' });
    assert.equal(f.calls.length, 1); assert.match(f.calls[0], /"operation\\":\\"verify/);
    assert.equal(f.saves(), 1); assert.equal((await f.runtime.view(f.id)).probe.state, 'cached');
    assert.match(f.tasks[0].command, /node-22\.12\.0\/bin\/node/);
    assert.match(f.tasks[0].environment!.PATH, /^\/opt\/sakura-runtimes\/node-22\.12\.0\/bin:/);
    f.runTask(async () => sample({ node: '22.12.01', python: '3.12.1' }));
    await assert.rejects(f.runtime.select(f.id, { node: '22.12.0' }), (error: unknown) => error instanceof AppError && error.code === 'RUNTIME_VERSION_MISMATCH');
    assert.equal(f.saves(), 1);
    f.machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ code: 73, stdout: JSON.stringify({ version: 1, ok: false, code: 'INSTALL_INCO…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 73, stdout: JSON.stringify({ version: 1, ok: false, code: 'INSTALL_INCO…`) through a Promise.
     * 验证场景 / Scenario: selected pins require a read-only ready receipt before the project task and compare exact versions
     * 协作入口 / Collaborators: `JSON.stringify`.
     */
    async () => ({ code: 73, stdout: JSON.stringify({ version: 1, ok: false, code: 'INSTALL_INCOMPLETE' }), stderr: '' });
    await assert.rejects(f.runtime.select(f.id, { node: '22.12.0' }), /INSTALL_INCOMPLETE/);
    assert.equal(f.saves(), 1);
  } finally { await f.runtime.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: select validates a candidate environment instead of retaining the previous runtime overrides
 * 协作入口 / Collaborators: `fixture`, `f.runtime.select`, `assert.equal`, `f.saves`.
 * 检查边界 / Checked boundaries: `assert.equal(f.tasks[0].environment?.PATH, '/srv/projects/one/bin')`; `assert.equal(f.tasks[0].environment?.VIRTUAL_ENV, undefined)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('select validates a candidate environment instead of retaining the previous runtime overrides', async () => {
  const f = fixture({ runtimes: { python: '3.12.1' }, environment: { PATH: '/srv/projects/one/bin', TOKEN: 'private' } });
  try {
    await f.runtime.select(f.id, {});
    assert.equal(f.tasks[0].environment?.PATH, '/srv/projects/one/bin');
    assert.equal(f.tasks[0].environment?.VIRTUAL_ENV, undefined);
    assert.equal(f.calls.length, 0); assert.equal(f.saves(), 1);
    await f.runtime.select(f.id, { node: undefined, python: undefined });
    assert.deepEqual(f.configuration().runtimes, {});
    assert.equal(f.calls.length, 0); assert.equal(f.saves(), 2);
  } finally { await f.runtime.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: configuration, scope or live changes during validation refuse cache and selection
 * 协作入口 / Collaborators: `fixture`, `f.runTask`, `assert.rejects`, `f.runtime.probe`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.runtime.probe(f.id), /已变化/)`; `assert.equal((f.runtime as any).samples.size, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('configuration, scope or live changes during validation refuse cache and selection', async () => {
  for (const change of ['config', 'scope', 'live'] as const) {
    const f = fixture();
    try {
      f.runTask(async () => {
        if (change === 'config') f.replace({ environment: { FLAG: 'new' } });
        if (change === 'scope') f.scope('0123456789abcdef');
        if (change === 'live') f.machines.live.set(f.id, { ...f.live } as any);
        return sample();
      });
      await assert.rejects(f.runtime.probe(f.id), /已变化/);
      assert.equal((f.runtime as any).samples.size, 0);
    } finally { await f.runtime.close(); }
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: select supplies CAS and a lock-local guard for stop/start or abort while save awaits
 * 状态影响 / State effects: `f.workspaces.save`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.configuration`, `assert.rejects`, `f.runtime.select`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.runtime.select(f.id, {}, controller.signal))`; `assert.equal((f.runtime as any).samples.size, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('select supplies CAS and a lock-local guard for stop/start or abort while save awaits', async () => {
  for (const change of ['config', 'live', 'abort', 'scope'] as const) {
    const f = fixture(), controller = new AbortController();
    const original = f.configuration();
    f.workspaces.save = /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _id; project; _allowed; expected; commit。
     * 结果：返回分支计算值（`f.machines.locked<Project>(f.id, async () => { assert.equal(expected, projectVer…`），以 Promise 交付。
     * Result: Return the branch-computed value (`f.machines.locked<Project>(f.id, async () => { assert.equal(expected, projectVer…`) through a Promise.
     * 验证场景 / Scenario: select supplies CAS and a lock-local guard for stop/start or abort while save awaits
     * 协作入口 / Collaborators: `f.machines.locked`.
     */
    async (_id, project, _allowed, expected, commit) => f.machines.locked<Project>(f.id, async () => {
      assert.equal(expected, projectVersion(original)); commit?.();
      await Promise.resolve();
      if (change === 'config') f.replace({ environment: { KEEP: 'concurrent' } });
      if (change === 'live') f.machines.live.set(f.id, { ...f.live } as any);
      if (change === 'abort') controller.abort();
      if (change === 'scope') f.scope('0123456789abcdef');
      if (projectVersion(f.configuration()) !== expected) throw new AppError('配置已变化', 409);
      commit?.(); return projectSchema.parse(project);
    });
    try {
      await assert.rejects(f.runtime.select(f.id, {}, controller.signal));
      assert.equal((f.runtime as any).samples.size, 0); assert.equal(f.saves(), 0);
      assert.equal(f.configuration().environment?.KEEP, change === 'config' ? 'concurrent' : undefined);
    } finally { await f.runtime.close(); }
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: malformed tool replies, timeout and unconfirmed cleanup never publish raw data or save
 * 协作入口 / Collaborators: `fixture`, `sample`, `'x'.repeat`, `JSON.stringify`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.runtime.select(f.id, {}))`; `assert.equal(f.saves(), 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('malformed tool replies, timeout and unconfirmed cleanup never publish raw data or save', async () => {
  const f = fixture();
  try {
    for (const result of [{ code: 0, stderr: '', stdout: 'private-body' },
      { ...sample(), stdout: 'x'.repeat(4097) }, { ...sample(), stderr: 'private-body' },
      { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true, bootId, declared: {}, actual: { node: 'private-body', python: '' } }) },
      { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: false, code: 'TOOL_TIMEOUT' }) }]) {
      f.runTask(async () => result); await assert.rejects(f.runtime.select(f.id, {}));
      assert.equal(f.saves(), 0); assert.equal((f.runtime as any).samples.size, 0);
      assert.ok(!JSON.stringify(await f.runtime.view(f.id)).includes('private-body'));
    }
    f.runTask(async () => { throw new AppError('unconfirmed private-body', 503, 'GUEST_TASK_CLEANUP_FAILED'); });
    await assert.rejects(f.runtime.probe(f.id), (error: unknown) => error instanceof AppError && error.status === 503);
    assert.equal((await f.runtime.view(f.id)).probe.errorCode, 'GUEST_TASK_CLEANUP_FAILED');
    assert.ok(!JSON.stringify(await f.runtime.view(f.id)).includes('private-body'));
  } finally { await f.runtime.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: close aborts and waits for the complete task cleanup before resolving
 * 协作入口 / Collaborators: `fixture`, `deferred`, `f.runTask`, `f.runtime.probe`.
 * 检查边界 / Checked boundaries: `assert.rejects(operation)`; `assert.equal(closed, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('close aborts and waits for the complete task cleanup before resolving', async () => {
  const f = fixture(), entered = deferred<void>(), cleanup = deferred<void>();
  f.runTask(async (_machine, _id, _project, _execution, signal) => {
    entered.resolve(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    await cleanup.promise; signal.throwIfAborted(); return sample();
  });
  const operation = f.runtime.probe(f.id), rejected = assert.rejects(operation);
  await entered.promise;
  let closed = false; const closing = f.runtime.close().then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false);
  cleanup.resolve(); await Promise.all([closing, rejected]);
  assert.equal(closed, true); assert.equal((f.runtime as any).samples.size, 0);
  await assert.rejects(f.runtime.probe(f.id), /正在关闭/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: close preserves an unconfirmed cleanup failure after cancellation
 * 协作入口 / Collaborators: `fixture`, `deferred`, `f.runTask`, `f.runtime.probe`.
 * 检查边界 / Checked boundaries: `assert.rejects(operation, (error: unknown) => error instanceof AppError && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED')`; `assert.rejects(f.runtime.close(), (error: unknown) => error instanceof AppError && error.status === 503 && error.code === 'PROJECT…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('close preserves an unconfirmed cleanup failure after cancellation', async () => {
  const f = fixture(), entered = deferred<void>();
  f.runTask(async (_machine, _id, _project, _execution, signal) => {
    entered.resolve(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    throw new AppError('cleanup unconfirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  });
  const operation = f.runtime.probe(f.id), failed = assert.rejects(operation,
    (error: unknown) => error instanceof AppError && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED');
  await entered.promise;
  await assert.rejects(f.runtime.close(), (error: unknown) => error instanceof AppError &&
    error.status === 503 && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED');
  await failed; assert.equal((f.runtime as any).samples.size, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: real Workspaces candidate resolver does not reread config and preserves only the candidate pins
 * 状态影响 / State effects: `workspaces.config`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `projectSchema.parse`, `workspaces.resolveProject`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(resolved.environment?.TOKEN, 'resolved')`; `assert.equal(resolved.environment?.PATH, '/opt/sakura-runtimes/node-22.12.0/bin:/project/bin')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('real Workspaces candidate resolver does not reread config and preserves only the candidate pins', async () => {
  const f = fixture(), workspaces = new Workspaces(f.machines, { network: { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ HTTPS_PROXY: 'https://proxy.example' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ HTTPS_PROXY: 'https://proxy.example' })`) through a Promise.
   * 验证场景 / Scenario: real Workspaces candidate resolver does not reread config and preserves only the candidate pins
   */
  environment: async () => ({ HTTPS_PROXY: 'https://proxy.example' }) } as any,
    secrets: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; references: object。
     * 结果：返回分支计算值（`Object.keys(references || {}).length ? { TOKEN: 'resolved' } : {}`），以 Promise 交付。
     * Result: Return the branch-computed value (`Object.keys(references || {}).length ? { TOKEN: 'resolved' } : {}`) through a Promise.
     * 验证场景 / Scenario: real Workspaces candidate resolver does not reread config and preserves only the candidate pins
     * 协作入口 / Collaborators: `Object.keys`.
     */
    resolve: async (_id: string, references: object) => Object.keys(references || {}).length ? { TOKEN: 'resolved' } : {} } as any });
  workspaces.config = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: real Workspaces candidate resolver does not reread config and preserves only the candidate pins
   * 失败 / Failure: `new Error('candidate resolver must not read current config')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw new Error('candidate resolver must not read current config'); };
  try {
    const candidate = projectSchema.parse({ directory: '/srv/projects/one', environment: { PATH: '/project/bin' }, secrets: { TOKEN: 'ref' }, runtimes: { node: '22.12.0' } });
    const resolved = await workspaces.resolveProject(f.id, candidate);
    assert.equal(resolved.environment?.TOKEN, 'resolved');
    assert.equal(resolved.environment?.PATH, '/opt/sakura-runtimes/node-22.12.0/bin:/project/bin');
    assert.equal(resolved.environment?.VIRTUAL_ENV, undefined);
    assert.equal(resolved.environment?.HTTPS_PROXY, 'https://proxy.example');
    assert.deepEqual(candidate.environment, { PATH: '/project/bin' });
  } finally { await Promise.all([f.runtime.close(), workspaces.close()]); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: real Workspaces commit guard runs after an async guard and prevents publication
 * 协作入口 / Collaborators: `randomUUID`, `Object.assign`, `locks.locked.bind`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.rejects(saving)`; `assert.ok(checks >= 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('real Workspaces commit guard runs after an async guard and prevents publication', async () => {
  const id = randomUUID(), live = { status: 'running' }, locks = new Machines({} as any, fakeVmNetwork);
  const machines = Object.assign(new EventEmitter(), { records: new Map([[id, { template: 'none' }]]), live: new Map([[id, live]]),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: real Workspaces commit guard runs after an async guard and prevents publication
     */
    state: () => 'running', /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ template: 'none' })`）。
     * Result: Return the branch-computed value (`({ template: 'none' })`).
     * 验证场景 / Scenario: real Workspaces commit guard runs after an async guard and prevents publication
     */
    get: () => ({ template: 'none' }), locked: locks.locked.bind(locks) }) as unknown as MachinesType;
  const workspaces = new Workspaces(machines);
  await mkdir(vmDir(id), { recursive: true }); const file = join(vmDir(id), 'project.json');
  const project = projectSchema.parse({ directory: '/srv/projects/one' }); await writeFile(file, JSON.stringify(project));
  const controller = new AbortController(), entered = deferred<void>(), resume = deferred<void>(); let checks = 0;
  workspaces.beforeConfigChange(async () => { entered.resolve(); await resume.promise; });
  const saving = workspaces.save(id, project, undefined, projectVersion(project), () => { ++checks; controller.signal.throwIfAborted(); });
  const rejected = assert.rejects(saving); await entered.promise; controller.abort(); resume.resolve();
  try { await rejected; assert.ok(checks >= 2); assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), project); }
  finally { await workspaces.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: real Workspaces rechecks CAS after an async guard and preserves a concurrent file update
 * 协作入口 / Collaborators: `randomUUID`, `Object.assign`, `locks.locked.bind`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.rejects(workspaces.save(id, original, undefined, projectVersion(original)), /项目配置已变化/)`; `assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), concurrent)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('real Workspaces rechecks CAS after an async guard and preserves a concurrent file update', async () => {
  const id = randomUUID(), live = { status: 'running' }, locks = new Machines({} as any, fakeVmNetwork);
  const machines = Object.assign(new EventEmitter(), { records: new Map([[id, { template: 'none' }]]), live: new Map([[id, live]]),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: real Workspaces rechecks CAS after an async guard and preserves a concurrent file update
     */
    state: () => 'running', /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ template: 'none' })`）。
     * Result: Return the branch-computed value (`({ template: 'none' })`).
     * 验证场景 / Scenario: real Workspaces rechecks CAS after an async guard and preserves a concurrent file update
     */
    get: () => ({ template: 'none' }), locked: locks.locked.bind(locks) }) as unknown as MachinesType;
  const workspaces = new Workspaces(machines);
  await mkdir(vmDir(id), { recursive: true }); const file = join(vmDir(id), 'project.json');
  const original = projectSchema.parse({ directory: '/srv/projects/one' }), concurrent = { ...original, repository: 'https://example.test/new' };
  await writeFile(file, JSON.stringify(original));
  workspaces.beforeConfigChange(async () => { await writeFile(file, JSON.stringify(concurrent)); });
  try {
    await assert.rejects(workspaces.save(id, original, undefined, projectVersion(original)), /项目配置已变化/);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), concurrent);
  } finally { await workspaces.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: helpers are fixed isolated Python, bounded and syntactically valid without executing project code
 * 协作入口 / Collaborators: `runtimeProbeCommand`, `runtimeInstallCommand`, `assert.match`, `probe.split("<<'SAKURA_RUNTIME_PROBE'\n")[1].replace`.
 * 检查边界 / Checked boundaries: `assert.match(probe, /exec \/usr\/bin\/python3 -I -S -/)`; `assert.match(probe, /os\.O_NOFOLLOW\|os\.O_NONBLOCK/)`.
 */
test('helpers are fixed isolated Python, bounded and syntactically valid without executing project code', () => {
  const probe = runtimeProbeCommand({ node: '22.12.0' }), install = runtimeInstallCommand({ operation: 'verify', tool: 'python', version: '3.12.1' });
  assert.match(probe, /exec \/usr\/bin\/python3 -I -S -/);
  assert.match(probe, /os\.O_NOFOLLOW\|os\.O_NONBLOCK/); assert.match(probe, /stat\.S_ISREG/);
  assert.match(probe, /monotonic\(\)\+4/); assert.match(probe, /len\(buffer\)\+len\(data\)>4096/);
  const sources = [probe.split("<<'SAKURA_RUNTIME_PROBE'\n")[1].replace(/SAKURA_RUNTIME_PROBE$/, ''),
    install.split("<<'SAKURA_RUNTIME_INSTALL'\n")[1].replace(/SAKURA_RUNTIME_INSTALL$/, '')];
  const parsed = spawnSync('python', ['-I', '-S', '-c', 'import ast,json,sys; [ast.parse(item) for item in json.load(sys.stdin)]'], { input: JSON.stringify(sources), encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr || parsed.error?.message);
  assert.throws(() => runtimeInstallCommand({ operation: 'verify', tool: 'node', version: '22.12.0', network: { PATH: '/project/bin' } }));
  assert.throws(() => runtimeInstallSetup('debian', { HTTPS_PROXY: 'https://user:secret@proxy.example' }));
  assert.ok(!runtimeInstallSetup('debian').includes('project'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: receipt parser rejects unknown fields, wrong identity and prepared artifacts cannot verify ready
 * 协作入口 / Collaborators: `randomUUID`, `assert.equal`, `parseRuntimeInstall`, `receipt`.
 * 检查边界 / Checked boundaries: `assert.equal(parseRuntimeInstall(receipt('ready', id), { tool: 'node', version: '22.12.0', phase: 'ready' }).installId, id)`; `assert.throws(() => parseRuntimeInstall(receipt('prepared', id), { tool: 'node', version: '22.12.0', phase: 'ready' }))`.
 */
test('receipt parser rejects unknown fields, wrong identity and prepared artifacts cannot verify ready', () => {
  const id = randomUUID();
  assert.equal(parseRuntimeInstall(receipt('ready', id), { tool: 'node', version: '22.12.0', phase: 'ready' }).installId, id);
  assert.throws(() => parseRuntimeInstall(receipt('prepared', id), { tool: 'node', version: '22.12.0', phase: 'ready' }));
  assert.throws(() => parseRuntimeInstall(receipt('ready', id), { tool: 'node', version: '22.12.0', phase: 'ready', installId: randomUUID() }));
  assert.throws(() => parseRuntimeInstall(receipt('ready', id), { tool: 'node', version: '22.12.0', phase: 'ready', architecture: 'aarch64' }));
  assert.throws(() => parseRuntimeProbe({ ...sample(), stdout: JSON.stringify({ ...JSON.parse(sample().stdout), secret: 'body' }) }));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: install holds the VM lock, confirms only after the full task and passes no project environment
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.runInstallTask`, `f.runtime.install`, `f.runtime.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done', job.error)`; `assert.equal(confirm, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('install holds the VM lock, confirms only after the full task and passes no project environment', async () => {
  const f = fixture({ environment: { TOKEN: 'project-private-body', PATH: '/project/bin' } });
  let completed = false, confirm = 0;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: install holds the VM lock, confirms only after the full task and passes no project environment
   * 协作入口 / Collaborators: `f.calls.push`, `command.includes`, `assert.equal`, `command.match`.
   * 检查边界 / Checked boundaries: `assert.equal(completed, true)`.
   */
  async (_id, command) => {
    f.calls.push(command);
    if (!command.includes('SAKURA_RUNTIME_INSTALL')) return { code: 0, stdout: bootId, stderr: '' };
    if (command.includes('\\"operation\\":\\"confirm\\"')) {
      assert.equal(completed, true); ++confirm;
      const id = command.match(/\\"installId\\":\\"([a-f0-9-]{36})/)!;
      return receipt('ready', id[1]);
    }
    return { code: 0, stdout: JSON.stringify({ version: 1, ok: true, result: null }), stderr: '' };
  };
  f.runInstallTask(async (_machine, _id, script, _signal, _log, _timeout, _agent, _cleanup, options) => {
    assert.ok(!script.includes('project-private-body')); assert.ok(!script.includes('/project/bin'));
    assert.match(script, /env -i PATH=/); assert.match(script, /--relocatable/);
    const id = script.match(/\\"installId\\":\\"([a-f0-9-]{36})/)!;
    assert.ok(options?.runId); completed = true; return receipt('prepared', id[1]);
  });
  try {
    const job = await f.runtime.install(f.id, { tool: 'node', version: '22.12.0' }); await f.runtime.jobs.wait(f.id);
    assert.equal(job.status, 'done', job.error); assert.equal(confirm, 1);
    assert.ok(f.calls.every(value => !value.includes('project-private-body')));
  } finally { await f.runtime.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: install cleanup failure is retained and never calls ready confirmation
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.runInstallTask`, `f.runtime.install`, `f.runtime.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.errorCode, 'RUNTIME_INSTALL_CLEANUP_FAILED')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('install cleanup failure is retained and never calls ready confirmation', async () => {
  const f = fixture();
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回分支计算值（`command.includes('SAKURA_RUNTIME_INSTALL') ? { code: 73, stdout: JSON.stringify(…`），以 Promise 交付。
   * Result: Return the branch-computed value (`command.includes('SAKURA_RUNTIME_INSTALL') ? { code: 73, stdout: JSON.stringify(…`) through a Promise.
   * 验证场景 / Scenario: install cleanup failure is retained and never calls ready confirmation
   * 协作入口 / Collaborators: `f.calls.push`, `command.includes`, `JSON.stringify`.
   */
  async (_id, command) => {
    f.calls.push(command);
    return command.includes('SAKURA_RUNTIME_INSTALL') ? { code: 73, stdout: JSON.stringify({ version: 1, ok: false, code: 'INSTALL_SCOPE_ACTIVE' }), stderr: '' }
      : { code: 0, stdout: bootId, stderr: '' };
  };
  f.runInstallTask(async () => { throw new AppError('task cleanup unconfirmed', 503, 'GUEST_TASK_CLEANUP_FAILED'); });
  try {
    const job = await f.runtime.install(f.id, { tool: 'node', version: '22.12.0' }); await f.runtime.jobs.wait(f.id);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'RUNTIME_INSTALL_CLEANUP_FAILED');
    assert.equal(f.calls.filter(value => value.includes('\\"operation\\":\\"recover\\"')).length, 3);
    assert.ok(!f.calls.some(value => value.includes('\\"operation\\":\\"confirm\\"')));
  } finally { await f.runtime.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: install refuses confirmation after its captured live changes
 * 协作入口 / Collaborators: `fixture`, `f.runInstallTask`, `f.runtime.install`, `f.runtime.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.errorCode, 'RUNTIME_INSTALL_CLEANUP_FAILED')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('install refuses confirmation after its captured live changes', async () => {
  const f = fixture();
  f.runInstallTask(async (_machine, _id, script) => {
    const id = script.match(/\\"installId\\":\\"([a-f0-9-]{36})/)!;
    f.machines.live.set(f.id, { ...f.live } as any);
    return receipt('prepared', id[1]);
  });
  try {
    const job = await f.runtime.install(f.id, { tool: 'node', version: '22.12.0' }); await f.runtime.jobs.wait(f.id);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'RUNTIME_INSTALL_CLEANUP_FAILED');
    assert.ok(!f.calls.some(value => value.includes('\\"operation\\":\\"confirm\\"')));
  } finally { await f.runtime.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: close waits for installer cancellation and preserves its cleanup failure
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `deferred`, `f.runInstallTask`, `f.runtime.install`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.runtime.close(), (error: unknown) => error instanceof AppError && error.status === 503 && error.code === 'RUNTIME…`; `assert.equal(job.status, 'error')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('close waits for installer cancellation and preserves its cleanup failure', async () => {
  const f = fixture(), entered = deferred<void>();
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回分支计算值（`command.includes('SAKURA_RUNTIME_INSTALL') ? { code: 73, stdout: JSON.stringify(…`），以 Promise 交付。
   * Result: Return the branch-computed value (`command.includes('SAKURA_RUNTIME_INSTALL') ? { code: 73, stdout: JSON.stringify(…`) through a Promise.
   * 验证场景 / Scenario: close waits for installer cancellation and preserves its cleanup failure
   * 协作入口 / Collaborators: `f.calls.push`, `command.includes`, `JSON.stringify`.
   */
  async (_id, command) => {
    f.calls.push(command);
    return command.includes('SAKURA_RUNTIME_INSTALL') ? { code: 73, stdout: JSON.stringify({ version: 1, ok: false, code: 'INSTALL_SCOPE_ACTIVE' }), stderr: '' }
      : { code: 0, stdout: bootId, stderr: '' };
  };
  f.runInstallTask(async (_machine, _id, _script, signal) => {
    entered.resolve(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    throw new AppError('cleanup unconfirmed', 503, 'GUEST_TASK_CLEANUP_FAILED');
  });
  const job = await f.runtime.install(f.id, { tool: 'node', version: '22.12.0' }); await entered.promise;
  await assert.rejects(f.runtime.close(), (error: unknown) => error instanceof AppError &&
    error.status === 503 && error.code === 'RUNTIME_INSTALL_CLEANUP_FAILED');
  assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'RUNTIME_INSTALL_CLEANUP_FAILED');
});
