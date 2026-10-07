/**
 * 模块职责：回归验证模块，围绕 `private-containers` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `private-containers`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: container jobs keep the requested project when the active project changes; saved Docker bindings prevent changes after the container plugin closes and while containers are stopped.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Machines as MachinesType } from '../server/machines.ts';
const directory = await mkdtemp(join(tmpdir(), 'sakura-private-container-unit-'));
process.env.SAKURA_DATA_DIR = directory;
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Containers } = await import('../server/containers.ts');
type Runtime = {
  present: boolean;
  running: boolean;
  valid: boolean;
  reason: string | null;
  runId: string | null;
  containers: number;
};
after(async () => {
  const owned = await realpath(directory);
  assert.equal(dirname(owned), await realpath(tmpdir()));
  assert.ok(basename(owned).startsWith('sakura-private-container-unit-'));
  await rm(owned, { recursive: true, force: true });
});
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `id, machines, workspaces, containers, project, runtime, calls, within, close`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, machines, workspaces, containers, project, runtime, calls, within, close`; the actual branch determines its shape.
 * 状态影响 / State effects: `machines.locked`, `machines.exec`, `calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `new Date().toISOString`, `Object.assign`, `Machines.prototype.locked.bind`.
 */
async function fixture() {
  const id = randomUUID(),
    records = new Map([
      [
        id,
        {
          id,
          name: 'test',
          distro: 'debian',
          template: 'none',
          createdAt: new Date().toISOString(),
          snapshots: [],
        },
      ],
    ]);
  const calls: Array<{ project: string; command: string }> = [],
    runtime = new Map<string, Runtime>();
  const m = Object.assign(new EventEmitter(), {
    records,
    live: new Map(),
    locks: new Set(),
    operations: new Set(),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: key: string。
     * 结果：返回分支计算值（`records.get(id)`）。
     * Result: Return the branch-computed value (`records.get(id)`).
     * 协作入口 / Collaborators: `assert.equal`, `records.get`.
     * 检查边界 / Checked boundaries: `assert.equal(key, id)`.
     */
    get: (key: string) => {
      assert.equal(key, id);
      return records.get(id);
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     */
    state: () => 'running',
  });
  const machines = m as unknown as MachinesType;
  machines.locked = Machines.prototype.locked.bind(machines);
  await mkdir(join(directory, 'machines', id), { recursive: true });
  const workspaces = new Workspaces(machines);
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `workspaces.projects.current`, `calls.push`, `command.includes`, `runtime.has`.
   */
  async (_id, command) => {
    const project = workspaces.projects.current(id);
    calls.push({ project, command });
    if (command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS'))
      return { code: 0, stdout: 'absent\n', stderr: '' };
    if (command.includes('SAKURA_PROJECT_DOCKER_PRESENT'))
      return { code: 0, stdout: runtime.has(project) ? 'SAKURA_PROJECT_DOCKER_PRESENT\n' : '', stderr: '' };
    if (command.includes('data=json.loads') && command.includes('containerd'))
      return {
        code: 0,
        stdout: JSON.stringify(
          runtime.get(project) || {
            present: false,
            running: false,
            valid: false,
            reason: null,
            runId: null,
            containers: 0,
          },
        ),
        stderr: '',
      };
    return { code: 0, stdout: '', stderr: '' };
  };
  const index = await workspaces.projects.create(id, 'private', () =>
    workspaces
      .save(id, {
        directory: '/workspace/private',
        networkIsolation: 'private',
        environment: { SCOPE: 'private' },
      })
      .then(() => {}),
  );
  const project = index.active,
    containers = new Containers(machines, workspaces);
  runtime.set(project, {
    present: true,
    running: true,
    valid: true,
    reason: null,
    runId: randomUUID(),
    containers: 1,
  });
  calls.length = 0;
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: work: () => Promise<T>。
   * 结果：返回分支计算值（`workspaces.projects.with(id, project, work)`）。
   * Result: Return the branch-computed value (`workspaces.projects.with(id, project, work)`).
   * 协作入口 / Collaborators: `workspaces.projects.with`.
   */
  const within = <T>(work: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => Promise<T>) => workspaces.projects.with(id, project, work);
  return {
    id,
    machines,
    workspaces,
    containers,
    project,
    runtime,
    calls,
    within,
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `containers.close`, `workspaces.close`.
     */
    close: async () => {
      await containers.close();
      await workspaces.close();
    },
  };
}
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: container jobs keep the requested project when the active project changes
 * 协作入口 / Collaborators: `fixture`, `f.within`, `f.workspaces.projects.update`, `f.containers.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(f.containers.jobs.view(f.id)?.status, 'done')`; `assert.equal(f.containers.jobs.view(f.id)?.projectId, f.project)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('container jobs keep the requested project when the active project changes', async () => {
  const f = await fixture();
  try {
    await f.within(() => f.containers.run(f.id, { action: 'start', id: '0123456789ab' }));
    await f.workspaces.projects.update(f.id, 'default');
    await f.containers.jobs.wait(f.id);
    assert.equal(f.containers.jobs.view(f.id)?.status, 'done');
    assert.equal(f.containers.jobs.view(f.id)?.projectId, f.project);
    assert.ok(f.calls.length > 1);
    assert.ok(f.calls.every((call) => call.project === f.project));
    const launch = f.calls.find((call) => call.command.includes('setsid sh'))!;
    assert.ok(launch.command.includes('nsenter --net=/run/netns/sk-' + f.project));
    assert.ok(launch.command.includes('/etc/sakura/docker/' + f.project + '/docker-client'));
    assert.ok(!launch.command.includes('unix:///var/run/docker.sock'));
  } finally {
    await f.close();
  }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: saved Docker bindings prevent changes after the container plugin closes and while containers are stopped
 * 状态影响 / State effects: `f.runtime.get(f.project)!.running`, `f.runtime.get(f.project)!.containers`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.containers.close`, `f.within`, `f.runtime.get`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.within(() => f.workspaces.config(f.id))).directory, '/workspace/new')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('saved Docker bindings prevent changes after the container plugin closes and while containers are stopped', async () => {
  const f = await fixture();
  try {
    await f.containers.close();
    const config = await f.within(() => f.workspaces.config(f.id));
    await f.within(() =>
      assert.rejects(
        f.workspaces.save(f.id, { ...config, directory: '/workspace/new' }),
        /移除项目容器并停止/,
      ),
    );
    f.runtime.get(f.project)!.running = false;
    await f.within(() =>
      assert.rejects(f.workspaces.save(f.id, { ...config, networkIsolation: 'host' }), /移除项目容器并停止/),
    );
    f.runtime.get(f.project)!.containers = 0;
    await f.within(() => f.workspaces.save(f.id, { ...config, directory: '/workspace/new' }));
    assert.equal((await f.within(() => f.workspaces.config(f.id))).directory, '/workspace/new');
  } finally {
    await f.close();
  }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an existing VM operation prevents container execution before any guest mutation
 * 协作入口 / Collaborators: `fixture`, `f.machines.locked`, `f.within`, `f.containers.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(f.containers.jobs.view(f.id)?.status, 'error')`; `assert.match(f.containers.jobs.view(f.id)?.error || '', /另一项操作/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('an existing VM operation prevents container execution before any guest mutation', async () => {
  const f = await fixture();
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const hold = f.machines.locked(
    f.id,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  try {
    await f.within(() => f.containers.run(f.id, { action: 'start', id: '0123456789ab' }));
    await f.containers.jobs.wait(f.id);
    assert.equal(f.containers.jobs.view(f.id)?.status, 'error');
    assert.match(f.containers.jobs.view(f.id)?.error || '', /另一项操作/);
    assert.equal(f.calls.length, 0);
  } finally {
    release();
    await hold;
    await f.close();
  }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: container cleanup stays usable when the project secret provider is unavailable
 * 协作入口 / Collaborators: `fixture`, `f.within`, `f.containers.jobs.wait`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(f.containers.jobs.view(f.id)?.status, 'done')`; `assert.ok(f.calls.some((call) => call.command.includes('docker-client')))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('container cleanup stays usable when the project secret provider is unavailable', async () => {
  const f = await fixture();
  try {
    const config = await f.within(() => f.workspaces.config(f.id));
    await f.within(() => f.workspaces.save(f.id, { ...config, secrets: { TOKEN: 'missing-key' } }));
    await f.within(() => f.containers.run(f.id, { action: 'stop', id: '0123456789ab' }));
    await f.containers.jobs.wait(f.id);
    assert.equal(f.containers.jobs.view(f.id)?.status, 'done');
    assert.ok(f.calls.some((call) => call.command.includes('docker-client')));
    assert.ok(f.calls.every((call) => !call.command.includes('export TOKEN')));
    await f.within(() => f.containers.run(f.id, { action: 'start', id: '0123456789ab' }));
    await f.containers.jobs.wait(f.id);
    assert.equal(f.containers.jobs.view(f.id)?.status, 'error');
    assert.match(f.containers.jobs.view(f.id)?.error || '', /启用 secrets 插件/);
  } finally {
    await f.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: container logs redact database credentials, Redis arguments and rotated project secrets
 * 状态影响 / State effects: `f.workspaces.resolvedConfig`, `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.within`, `assert.equal`, `f.close`.
 * 检查边界 / Checked boundaries: `assert.equal( result.log, '[私密配置已隐藏] [私密配置已隐藏] [私密配置已隐藏] [私密配置已隐藏] [私密配置已隐藏]', )`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('container logs redact database credentials, Redis arguments and rotated project secrets', async () => {
  const f = await fixture();
  try {
    const config = await f.within(() => f.workspaces.config(f.id));
    f.workspaces.resolvedConfig = /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ...config, secrets: { CUSTOM_CREDENTIAL: 'test-key' }, environment: { CUSTOM_…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ...config, secrets: { CUSTOM_CREDENTIAL: 'test-key' }, environment: { CUSTOM_…`) through a Promise.
     * 验证场景 / Scenario: container logs redact database credentials, Redis arguments and rotated project secrets
     */
    async () => ({
      ...config,
      secrets: { CUSTOM_CREDENTIAL: 'test-key' },
      environment: { CUSTOM_CREDENTIAL: 'new-secret' },
    });
    const previous = f.machines.exec;
    f.machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: id; command; args。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: container logs redact database credentials, Redis arguments and rotated project secrets
     * 协作入口 / Collaborators: `command.includes`, `JSON.stringify`, `previous`.
     */
    async (id, command, ...args) => {
      if (command.includes('docker inspect --format'))
        return {
          code: 0,
          stdout: JSON.stringify({
            Env: ['MYSQL_PASSWORD=database-secret', 'API_TOKEN=api-secret', 'CUSTOM_CREDENTIAL=old-secret'],
            Cmd: ['redis-server', '--requirepass', 'redis-secret'],
          }),
          stderr: '',
        };
      if (command.includes('docker logs --tail'))
        return {
          code: 0,
          stdout: 'database-secret api-secret redis-secret old-secret new-secret',
          stderr: '',
        };
      return previous(id, command, ...args);
    };
    const result = await f.within(() => f.containers.logs(f.id, '0123456789ab'));
    assert.equal(
      result.log,
      '[私密配置已隐藏] [私密配置已隐藏] [私密配置已隐藏] [私密配置已隐藏] [私密配置已隐藏]',
    );
  } finally {
    await f.close();
  }
});
