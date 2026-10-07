/**
 * 模块职责：回归验证模块，围绕 `workspaces-service-scope` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `workspaces-service-scope`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: workspace runtime displays an exited scope and keeps redacted application logs; unconfirmed scope status remains visible and does not discard available application logs.
 */
import { projectMetadataFile } from '../server/project-catalog.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Machines } from '../server/machines.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-workspace-service-scope-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Workspaces, projectSchema } = await import('../server/workspaces.ts');
const { ProjectServiceScopes } = await import('../server/project-service-scope.ts');
const { writeStore } = await import('../server/local-store.ts');
const { AppError } = await import('../server/model.ts');
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), await realpath(tmpdir()));
  assert.match(basename(owned), /^sakura-workspace-service-scope-test-/);
  await rm(owned, { recursive: true, force: true });
});
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: status = 'exited'; metadata = true。
 * 结果：返回受控对象，公开字段包括 `id, spaces, scopes, project, record, commands, machines, paused`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, spaces, scopes, project, record, commands, machines, paused`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `projectSchema.parse`, `Object.assign`, `scopes.intent`.
 */
async function fixture(status = 'exited', metadata = true) {
  const id = randomUUID(), bootId = randomUUID(), project = projectSchema.parse({ directory: '/workspace',
    environment: { TOKEN: 'owned-private-token' }, secrets: { TOKEN: 'token' },
    services: [{ name: 'api', command: 'sleep 600' }] });
  const commands: string[] = [];
  let machineState = 'running';
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([[id, {}]]), records: new Map([[id, { id, distro: 'alpine' }]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id, distro: 'alpine' })`）。
     * Result: Return the branch-computed value (`({ id, distro: 'alpine' })`).
     */
    get: () => ({ id, distro: 'alpine' }), /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`machineState`）。
     * Result: Return the branch-computed value (`machineState`).
     */
    state: () => machineState,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; action: () => Promise<unknown>。
     * 结果：返回分支计算值（`action()`），以 Promise 交付。
     * Result: Return the branch-computed value (`action()`) through a Promise.
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
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `commands.push`, `command.startsWith`, `JSON.stringify`, `command.includes`.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.startsWith('# SAKURA_PROJECT_MAIN_LEGACY_STATUS'))
        return { code: 0, stdout: 'absent', stderr: '' };
      if (command.startsWith('# SAKURA_PROJECT_SERVICE_STATUS')) {
        if (status === 'uncertain') return { code: 73, stdout: '', stderr: 'owned-private-token ownership mismatch' };
        return { code: 0, stdout: JSON.stringify({ status, bootId, record }), stderr: '' };
      }
      if (command.includes('then echo active')) return { code: 0, stdout: metadata ? '' : 'active', stderr: '' };
      if (command.startsWith('if tmux has-session'))
        return { code: 0, stdout: metadata ? '' : 'running\nold log owned-private-token', stderr: '' };
      if (command.startsWith('# SAKURA_PROJECT_RUNTIME_LOG')) return { code: 0, stdout: 'owned application log owned-private-token', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  }) as unknown as Machines;
  const scopes = new ProjectServiceScopes(machines, id, project);
  const record = { ...scopes.intent(project.services![0], bootId),
    inode: '55555', phase: status === 'stopped' ? 'stopped' as const : 'running' as const,
    panePid: 100, paneStartTicks: '12345', paneId: '%1', sessionId: '$1' };
  if (metadata) await writeStore(scopes.receipt('api'), record);
  const spaces = new Workspaces(machines, { secrets: { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ TOKEN: 'owned-private-token' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ TOKEN: 'owned-private-token' })`) through a Promise.
   */
  resolve: async () => ({ TOKEN: 'owned-private-token' }) } as any });
  await writeStore(projectMetadataFile(id, spaces.projects.current(id)), project);
  return { id, spaces, scopes, project, record, commands, machines, /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `machineState`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  paused: () => { machineState = 'paused'; } };
}
for (const field of ['remove', 'directory', 'network', 'command', 'environment', 'secrets', 'runtimes'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `next.services`, `next.directory`, `next.networkIsolation`, `next.services[0].command`, `next.environment`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `fixture`, `structuredClone`, `assert.rejects`, `f.spaces.save`.
   * 检查边界 / Checked boundaries: `assert.rejects(f.spaces.save(f.id, next), { code: 'SERVICE_SCOPE_CHANGED' })`; `assert.equal((await f.spaces.config(f.id)).services?.[0].command, f.project.services![0].command)`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test(`workspace refuses ${field} edits while exited service descendants retain a scope`, async () => {
    const f = await fixture();
    const next: any = structuredClone(f.project);
    if (field === 'remove') next.services = [];
    if (field === 'directory') next.directory = '/other';
    if (field === 'network') next.networkIsolation = 'private';
    if (field === 'command') next.services[0].command = 'sleep 601';
    if (field === 'environment') next.environment = { TOKEN: 'replacement' };
    if (field === 'secrets') next.secrets = { TOKEN: 'different-token' };
    if (field === 'runtimes') next.runtimes = { node: '22.1.0' };
    try {
      await assert.rejects(f.spaces.save(f.id, next), { code: 'SERVICE_SCOPE_CHANGED' });
      assert.equal((await f.spaces.config(f.id)).services?.[0].command, f.project.services![0].command);
    } finally { await f.spaces.close(); }
  });
}
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: workspace runtime displays an exited scope and keeps redacted application logs
 * 协作入口 / Collaborators: `fixture`, `f.spaces.runtime`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(runtime.status, 'exited')`; `assert.equal(runtime.services![0].status, 'exited')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('workspace runtime displays an exited scope and keeps redacted application logs', async () => {
  const f = await fixture();
  try {
    const runtime = await f.spaces.runtime(f.id);
    assert.equal(runtime.status, 'exited');
    assert.equal(runtime.services![0].status, 'exited');
    assert.match(runtime.services![0].log, /owned application log/);
    assert.match(runtime.services![0].log, /全部后代/);
    assert.equal(runtime.services![0].log.includes('owned-private-token'), false);
  } finally { await f.spaces.close(); }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unconfirmed scope status remains visible and does not discard available application logs
 * 协作入口 / Collaborators: `fixture`, `f.spaces.runtime`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(runtime.status, 'unconfirmed')`; `assert.equal(runtime.services![0].status, 'unconfirmed')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('unconfirmed scope status remains visible and does not discard available application logs', async () => {
  const f = await fixture('uncertain');
  try {
    const runtime = await f.spaces.runtime(f.id);
    assert.equal(runtime.status, 'unconfirmed');
    assert.equal(runtime.services![0].status, 'unconfirmed');
    assert.match(runtime.services![0].log, /ownership mismatch/);
    assert.match(runtime.services![0].log, /owned application log/);
    assert.equal(runtime.services![0].log.includes('owned-private-token'), false);
    await assert.rejects(f.spaces.save(f.id, { ...f.project, services: [] }), { code: 'SERVICE_SCOPE_CHANGED' });
  } finally { await f.spaces.close(); }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: service runtime rejects unverified root logs while an exactly stopped scope remains editable
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.spaces.runtime`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(runtime.status, 'unconfirmed')`; `assert.equal(runtime.services![0].status, 'unconfirmed')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('service runtime rejects unverified root logs while an exactly stopped scope remains editable', async () => {
  const f = await fixture('stopped'), execute = f.machines.exec;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: id; command; rest。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: service runtime rejects unverified root logs while an exactly stopped scope remains editable
   * 协作入口 / Collaborators: `command.startsWith`, `assert.match`, `assert.equal`, `command.includes`.
   * 检查边界 / Checked boundaries: `assert.match(command, /\/usr\/bin\/env -i .*\/usr\/bin\/python3 -I -S/)`; `assert.match(command, /O_NOFOLLOW/)`.
   */
  async (id, command, ...rest) => {
    if (command.startsWith('# SAKURA_PROJECT_RUNTIME_LOG')) {
      assert.match(command, /\/usr\/bin\/env -i .*\/usr\/bin\/python3 -I -S/);
      assert.match(command, /O_NOFOLLOW/); assert.match(command, /limit=8192/);
      assert.equal(command.includes('tail -c'), false); assert.equal(command.includes('owned-private-token'), false);
      return { code: 73, stdout: '', stderr: 'owned-private-token log identity refused' };
    }
    return execute.call(f.machines, id, command, ...rest);
  };
  try {
    const runtime = await f.spaces.runtime(f.id);
    assert.equal(runtime.status, 'unconfirmed'); assert.equal(runtime.services![0].status, 'unconfirmed');
    assert.match(runtime.services![0].log, /日志读取未确认/);
    assert.equal(runtime.services![0].log.includes('owned-private-token'), false);
    await f.spaces.save(f.id, { ...f.project, services: [] });
    assert.deepEqual((await f.spaces.config(f.id)).services, []);
  } finally { await f.spaces.close(); }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: confirmed stopped scope allows removal and binding changes without blocking configuration
 * 协作入口 / Collaborators: `fixture`, `f.spaces.save`, `f.spaces.config`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(saved.directory, '/changed')`; `assert.deepEqual(saved.services, [])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('confirmed stopped scope allows removal and binding changes without blocking configuration', async () => {
  const f = await fixture('stopped');
  try {
    await f.spaces.save(f.id, { ...f.project, directory: '/changed', networkIsolation: 'private', services: [] });
    const saved = await f.spaces.config(f.id);
    assert.equal(saved.directory, '/changed');
    assert.deepEqual(saved.services, []);
    assert.equal(JSON.parse(await readFile(f.scopes.receipt('api'), 'utf8')).phase, 'stopped');
  } finally { await f.spaces.close(); }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: confirmed stopped scope permits service edits while paused without attempting guest status
 * 协作入口 / Collaborators: `fixture`, `f.paused`, `f.spaces.save`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(f.commands.length, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('confirmed stopped scope permits service edits while paused without attempting guest status', async () => {
  const f = await fixture('stopped');
  f.paused();
  try {
    await f.spaces.save(f.id, { ...f.project, services: [{ ...f.project.services![0], command: 'sleep 601' }] });
    assert.equal(f.commands.length, 0);
  } finally { await f.spaces.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: paused stopped services without a main receipt require resume before changing main binding or service mode
 * 协作入口 / Collaborators: `fixture`, `f.paused`, `assert.rejects`, `f.spaces.save`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.spaces.save(f.id, { ...f.project, ...update }), { code: 'PROJECT_MAIN_SCOPE_CHANGED' })`; `assert.equal(f.commands.length, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('paused stopped services without a main receipt require resume before changing main binding or service mode', async () => {
  const f = await fixture('stopped'); f.paused();
  try {
    for (const update of [{ environment: {} }, { services: [] }, { command: 'sleep 601' }])
      await assert.rejects(f.spaces.save(f.id, { ...f.project, ...update }), { code: 'PROJECT_MAIN_SCOPE_CHANGED' });
    assert.equal(f.commands.length, 0); assert.equal((await f.spaces.config(f.id)).services?.length, 1);
  } finally { await f.spaces.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: paused unknown legacy services refuse command changes and partial removal before any guest access
 * 协作入口 / Collaborators: `fixture`, `projectSchema.parse`, `writeStore`, `projectMetadataFile`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.spaces.save(f.id, { ...project, services }), { code: 'SERVICE_SCOPE_UNMANAGED' })`; `assert.equal(f.commands.length, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('paused unknown legacy services refuse command changes and partial removal before any guest access', async () => {
  const f = await fixture('running', false);
  const project = projectSchema.parse({ ...f.project, services: [...f.project.services!, { name: 'second', command: 'sleep 600' }] });
  await writeStore(projectMetadataFile(f.id, f.spaces.projects.current(f.id)), project); f.paused();
  try {
    for (const services of [[{ ...project.services![0], command: 'sleep 601' }, project.services![1]], [project.services![1]]])
      await assert.rejects(f.spaces.save(f.id, { ...project, services }), { code: 'SERVICE_SCOPE_UNMANAGED' });
    assert.equal(f.commands.length, 0); assert.equal((await f.spaces.config(f.id)).services?.length, 2);
    assert.equal((await f.spaces.config(f.id)).services?.[0].command, 'sleep 600');
  } finally { await f.spaces.close(); }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy running services expose migration state and use no Python or installation probes
 * 协作入口 / Collaborators: `fixture`, `f.spaces.runtime`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(runtime.status, 'unconfirmed')`; `assert.equal(runtime.services![0].status, 'migration-required')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('legacy running services expose migration state and use no Python or installation probes', async () => {
  const f = await fixture('running', false);
  try {
    const runtime = await f.spaces.runtime(f.id);
    assert.equal(runtime.status, 'unconfirmed');
    assert.equal(runtime.services![0].status, 'migration-required');
    assert.match(runtime.services![0].log, /旧服务/);
    await assert.rejects(f.spaces.save(f.id, { ...f.project, services: [] }), { code: 'SERVICE_SCOPE_UNMANAGED' });
    assert.equal(f.commands.some(command => /python3|apk add|apt-get|SAKURA_PROJECT_SERVICE_/.test(command)), false);
    assert.equal(f.commands.some(command => /tail -c|SAKURA_PROJECT_RUNTIME_LOG/.test(command)), false);
  } finally { await f.spaces.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: workspace service cleanup failure retains the job error code while redacting private values
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.spaces.run`, `f.spaces.jobs.wait`, `f.spaces.projects.key`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.errorCode, 'SERVICE_CLEANUP_FAILED')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('workspace service cleanup failure retains the job error code while redacting private values', async () => {
  const f = await fixture('running'), execute = f.machines.exec;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: id; command。
   * 结果：返回分支计算值（`execute.call(f.machines, id, command)`），以 Promise 交付。
   * Result: Return the branch-computed value (`execute.call(f.machines, id, command)`) through a Promise.
   * 验证场景 / Scenario: workspace service cleanup failure retains the job error code while redacting private values
   * 失败 / Failure: `new AppError('owned-private-token cleanup connection failed', 503, 'SERVICE_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `command.startsWith`, `execute.call`.
   */
  async (id, command) => {
    if (command.startsWith('# SAKURA_PROJECT_SERVICE_STOP'))
      throw new AppError('owned-private-token cleanup connection failed', 503, 'SERVICE_CLEANUP_FAILED');
    return execute.call(f.machines, id, command);
  };
  try {
    const job = await f.spaces.run(f.id, 'stop', 'api');
    await f.spaces.jobs.wait(f.spaces.projects.key(f.id));
    assert.equal(job.status, 'error');
    assert.equal(job.errorCode, 'SERVICE_CLEANUP_FAILED');
    assert.match(job.error!, /清理未确认/);
    assert.equal(job.error!.includes('owned-private-token'), false);
    assert.equal(job.log.includes('owned-private-token'), false);
    assert.equal(JSON.parse(await readFile(f.scopes.receipt('api'), 'utf8')).phase, 'running');
  } finally { await f.spaces.close(); }
});
