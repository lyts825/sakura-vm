/**
 * 模块职责：回归验证模块，围绕 `workspaces` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `workspaces`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: metrics deduplicate concurrent reads and a failed old boot cannot evict the new boot sample; workspace shutdown detaches lifecycle observers before later machine events.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Machines as MachinesType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-workspace-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Workspaces } = await import('../server/workspaces.ts');
const { Machines } = await import('../server/machines.ts');
const { vmDir } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

const sample =
  'CPU\ncpu 1 0 0 9 0 0 0 0\ncpu 2 0 0 18 0 0 0 0\nMEMORY\nMemTotal: 1000 kB\nMemAvailable: 500 kB\nDISK\n/dev/vda 1000 500 500 50% /\nPROCESSES\n1 init\nUPTIME\n1.0 0.5\n';
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: id = 'vm'。
 * 结果：返回受控对象，公开字段包括 `machines, live, workspaces`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, live, workspaces`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `Object.assign`.
 */
function fixture(id = 'vm') {
  const live = { status: 'running', startedAt: 'first' };
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([[id, live]]),
    records: new Map([[id, { template: 'none' }]]),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`live.status`）。
     * Result: Return the branch-computed value (`live.status`).
     */
    state: () => live.status,
  }) as unknown as MachinesType;
  const workspaces = new Workspaces(machines);
  return { machines, live, workspaces };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: metrics deduplicate concurrent reads and a failed old boot cannot evict the new boot sample
 * 状态影响 / State effects: `machines.exec`, `live.status`, `live.startedAt`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `workspaces.metrics`, `assert.rejects`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(first, /old boot/)`; `assert.equal(workspaces.metrics('vm'), first)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('metrics deduplicate concurrent reads and a failed old boot cannot evict the new boot sample', async () => {
  const { machines, live, workspaces } = fixture();
  const pending: {
    resolve: /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: value: { stdout: string; stderr: string; code: number }。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (value: { stdout: string; stderr: string; code: number }) => void;
    reject: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: error: Error。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (error: Error) => void;
  }[] = [];
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`new Promise((resolve, reject) => pending.push({ resolve, reject }))`）。
   * Result: Return the branch-computed value (`new Promise((resolve, reject) => pending.push({ resolve, reject }))`).
   * 验证场景 / Scenario: metrics deduplicate concurrent reads and a failed old boot cannot evict the new boot sample
   */
  () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  try {
    const first = workspaces.metrics('vm');
    const rejected = assert.rejects(first, /old boot/);
    assert.equal(workspaces.metrics('vm'), first);
    assert.equal(pending.length, 1);
    live.status = 'stopped';
    machines.emit('change');
    live.status = 'running';
    live.startedAt = 'second';
    machines.emit('change');
    const second = workspaces.metrics('vm');
    assert.notEqual(second, first);
    pending[0].reject(new Error('old boot'));
    await rejected;
    assert.equal(workspaces.metrics('vm'), second);
    assert.equal(pending.length, 2);
    pending[1].resolve({ stdout: sample, stderr: '', code: 0 });
    assert.equal((await second).cpuPercent, 10);
  } finally {
    await workspaces.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: workspace shutdown detaches lifecycle observers before later machine events
 * 状态影响 / State effects: `machines.records.get('vm')!.template`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `machines.listenerCount`, `workspaces.close`.
 * 检查边界 / Checked boundaries: `assert.equal(machines.listenerCount('change'), 1)`; `assert.equal(machines.listenerCount('change'), 0)`.
 */
test('workspace shutdown detaches lifecycle observers before later machine events', async () => {
  const { machines, workspaces } = fixture();
  assert.equal(machines.listenerCount('change'), 1);
  await workspaces.close();
  machines.records.get('vm')!.template = 'node';
  assert.equal(machines.listenerCount('change'), 0);
  assert.doesNotThrow(() => machines.emit('change'));
  assert.equal(workspaces.jobs.view('vm'), null);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: saving project configuration cannot race a start that is still loading its configuration
 * 状态影响 / State effects: `machines.locked`, `machines.get`, `machines.exec`, `workspaces.config`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `fixture`, `mkdir`, `vmDir`.
 * 检查边界 / Checked boundaries: `assert.rejects(workspaces.save(id, { command: 'npm run changed' }), /另一项操作/)`; `assert.equal(JSON.parse(await readFile(file, 'utf8')).command, 'npm start')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('saving project configuration cannot race a start that is still loading its configuration', async () => {
  const id = randomUUID();
  const { machines, workspaces } = fixture(id);
  await mkdir(vmDir(id), { recursive: true });
  const file = join(vmDir(id), 'project.json');
  await writeFile(file, JSON.stringify({ command: 'npm start' }));
  const locks = new Machines({} as Engine, fakeVmNetwork);
  machines.locked = locks.locked.bind(locks);
  machines.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ template: 'none' }) as ReturnType<MachinesType['get']>`）。
   * Result: Return the branch-computed value (`({ template: 'none' }) as ReturnType<MachinesType['get']>`).
   * 验证场景 / Scenario: saving project configuration cannot race a start that is still loading its configuration
   */
  () => ({ template: 'none' }) as ReturnType<MachinesType['get']>;
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ stdout: '', stderr: '', code: 0 })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ stdout: '', stderr: '', code: 0 })`) through a Promise.
   * 验证场景 / Scenario: saving project configuration cannot race a start that is still loading its configuration
   */
  async () => ({ stdout: '', stderr: '', code: 0 });
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const loaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  const config = workspaces.config.bind(workspaces);
  workspaces.config = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: id。
   * 结果：返回分支计算值（`project`），以 Promise 交付。
   * Result: Return the branch-computed value (`project`) through a Promise.
   * 验证场景 / Scenario: saving project configuration cannot race a start that is still loading its configuration
   * 协作入口 / Collaborators: `config`, `entered`.
   */
  async (id) => {
    const project = await config(id);
    entered();
    await loaded;
    return project;
  };
  const starting = workspaces.run(id, 'start');
  try {
    await reading;
    await assert.rejects(workspaces.save(id, { command: 'npm run changed' }), /另一项操作/);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).command, 'npm start');
  } finally {
    release();
    await starting;
    await workspaces.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: project and service secret references require the secret provider instead of executing with missing values
 * 状态影响 / State effects: `machines.get`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `fixture`, `mkdir`, `vmDir`.
 * 检查边界 / Checked boundaries: `assert.rejects(workspaces.resolvedConfig(id), /启用 secrets 插件/)`; `assert.equal((await workspaces.resolvedConfig(id)).directory, '/workspace')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('project and service secret references require the secret provider instead of executing with missing values', async () => {
  const id = randomUUID();
  const { machines, workspaces } = fixture(id);
  machines.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ template: 'none' }) as ReturnType<MachinesType['get']>`）。
   * Result: Return the branch-computed value (`({ template: 'none' }) as ReturnType<MachinesType['get']>`).
   * 验证场景 / Scenario: project and service secret references require the secret provider instead of executing with missing values
   */
  () => ({ template: 'none' }) as ReturnType<MachinesType['get']>;
  await mkdir(vmDir(id), { recursive: true });
  const file = join(vmDir(id), 'project.json');
  try {
    for (const project of [
      { secrets: { TOKEN: 'project-key' } },
      { services: [{ name: 'worker', command: 'true', secrets: { TOKEN: 'service-key' } }] },
    ]) {
      await writeFile(file, JSON.stringify(project));
      await assert.rejects(workspaces.resolvedConfig(id), /启用 secrets 插件/);
    }
    await writeFile(file, JSON.stringify({ secrets: {}, services: [] }));
    assert.equal((await workspaces.resolvedConfig(id)).directory, '/workspace');
  } finally { await workspaces.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: core project binding protection includes SSH children when the IDE plugin is absent
 * 状态影响 / State effects: `machines.get`, `machines.locked`, `machines.exec`, `busy`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `fixture`, `mkdir`, `vmDir`.
 * 检查边界 / Checked boundaries: `assert.rejects(workspaces.save(id, { directory: '/workspace/moved' }), /停止项目 SSH/)`; `assert.rejects(workspaces.save(id, { networkIsolation: 'private' }), /停止项目 SSH/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('core project binding protection includes SSH children when the IDE plugin is absent', async () => {
  const id = randomUUID();
  const { machines, workspaces } = fixture(id);
  await mkdir(vmDir(id), { recursive: true });
  machines.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ template: 'none' }) as ReturnType<MachinesType['get']>`）。
   * Result: Return the branch-computed value (`({ template: 'none' }) as ReturnType<MachinesType['get']>`).
   * 验证场景 / Scenario: core project binding protection includes SSH children when the IDE plugin is absent
   */
  () => ({ template: 'none' }) as ReturnType<MachinesType['get']>;
  const locks = new Machines({} as Engine, fakeVmNetwork);
  machines.locked = locks.locked.bind(locks);
  let busy = true;
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回分支计算值（`({ code: 0, stderr: '', stdout: command.startsWith('# SAKURA_PROJECT_MAIN_LEGACY…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 0, stderr: '', stdout: command.startsWith('# SAKURA_PROJECT_MAIN_LEGACY…`) through a Promise.
   * 验证场景 / Scenario: core project binding protection includes SSH children when the IDE plugin is absent
   * 协作入口 / Collaborators: `command.startsWith`, `command.includes`.
   */
  async (_id, command) => ({ code: 0, stderr: '',
    stdout: command.startsWith('# SAKURA_PROJECT_MAIN_LEGACY_STATUS') ? 'absent\n' :
      busy && command.includes('SAKURA_PROJECT_SSH_BUSY') ? 'SAKURA_PROJECT_SSH_BUSY\n' : '' });
  try {
    await assert.rejects(workspaces.save(id, { directory: '/workspace/moved' }), /停止项目 SSH/);
    await assert.rejects(workspaces.save(id, { networkIsolation: 'private' }), /停止项目 SSH/);
    assert.equal((await workspaces.config(id)).directory, '/workspace');
    busy = false;
    await workspaces.save(id, { directory: '/workspace/moved', networkIsolation: 'private' });
    assert.equal((await workspaces.config(id)).directory, '/workspace/moved');
  } finally { await workspaces.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an unreadable SSH process scope fails closed before changing a project binding
 * 状态影响 / State effects: `machines.get`, `machines.locked`, `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `fixture`, `locks.locked.bind`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(workspaces.save(id, { directory: '/workspace/moved' }), /检查项目 SSH/)`; `assert.equal((await workspaces.config(id)).directory, '/workspace')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('an unreadable SSH process scope fails closed before changing a project binding', async () => {
  const id = randomUUID();
  const { machines, workspaces } = fixture(id);
  machines.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ template: 'none' }) as ReturnType<MachinesType['get']>`）。
   * Result: Return the branch-computed value (`({ template: 'none' }) as ReturnType<MachinesType['get']>`).
   * 验证场景 / Scenario: an unreadable SSH process scope fails closed before changing a project binding
   */
  () => ({ template: 'none' }) as ReturnType<MachinesType['get']>;
  const locks = new Machines({} as Engine, fakeVmNetwork);
  machines.locked = locks.locked.bind(locks);
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回分支计算值（`command.startsWith('# SAKURA_PROJECT_MAIN_LEGACY_STATUS') ? { code: 0, stdout: '…`），以 Promise 交付。
   * Result: Return the branch-computed value (`command.startsWith('# SAKURA_PROJECT_MAIN_LEGACY_STATUS') ? { code: 0, stdout: '…`) through a Promise.
   * 验证场景 / Scenario: an unreadable SSH process scope fails closed before changing a project binding
   * 协作入口 / Collaborators: `command.startsWith`.
   */
  async (_id, command) => command.startsWith('# SAKURA_PROJECT_MAIN_LEGACY_STATUS')
    ? { code: 0, stdout: 'absent\n', stderr: '' }
    : { code: 1, stdout: '', stderr: 'process inspection unavailable' };
  try {
    await assert.rejects(workspaces.save(id, { directory: '/workspace/moved' }), /检查项目 SSH/);
    assert.equal((await workspaces.config(id)).directory, '/workspace');
  } finally { await workspaces.close(); }
});
