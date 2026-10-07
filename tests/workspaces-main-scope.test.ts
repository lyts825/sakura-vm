/**
 * 模块职责：回归验证模块，围绕 `workspaces-main-scope` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `workspaces-main-scope`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: runtime reads exact identity ticket without installing or advancing the host journal; stopped scope with unclosed identity ticket rejects binding edits and reports unconfirmed.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = await mkdtemp(join(tmpdir(), 'sakura-workspaces-main-test-'));
process.env.SAKURA_DATA_DIR = root;
const { mainFixture, scopeRequest } = await import('./project-main-fixture.ts');
const { ProjectServiceScopes } = await import('../server/project-service-scope.ts');
const { serviceSchema } = await import('../server/project-services.ts');
const { writeStore } = await import('../server/local-store.ts');
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), await realpath(tmpdir())); assert.match(basename(owned), /^sakura-workspaces-main-test-/);
  await rm(owned, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: runtime reads exact identity ticket without installing or advancing the host journal
 * 协作入口 / Collaborators: `mainFixture`, `f.startMain`, `import`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.spaces.runtime(f.id)).status, 'running')`; `assert.equal(f.identity.state.ensureCalls, ensures)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('runtime reads exact identity ticket without installing or advancing the host journal', async () => {
  const f = await mainFixture();
  try {
    await f.startMain();
    const { vmDir } = await import('../server/model.ts');
    const file = join(vmDir(f.id), 'project-identities/default.json'), before = await readFile(file, 'utf8');
    const ensures = f.identity.state.ensureCalls;
    assert.equal((await f.spaces.runtime(f.id)).status, 'running');
    assert.equal(f.identity.state.ensureCalls, ensures); assert.equal(f.identity.state.readonlyCalls, 1);
    assert.equal(await readFile(file, 'utf8'), before);
    f.identity.tickets.delete(f.state.main!.runId);
    const unknown = await f.spaces.runtime(f.id);
    assert.equal(unknown.status, 'unconfirmed'); assert.equal(unknown.main!.status, 'unconfirmed');
    assert.equal(await readFile(file, 'utf8'), before);
  } finally { await f.spaces.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stopped scope with unclosed identity ticket rejects binding edits and reports unconfirmed
 * 状态影响 / State effects: `f.identity.state.stopFailures`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mainFixture`, `f.startMain`, `assert.rejects`, `f.scope.stop`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scope.stop(f.state.main!), { code: 'PROJECT_MAIN_CLEANUP_FAILED' })`; `assert.equal((await f.spaces.runtime(f.id)).status, 'unconfirmed')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('stopped scope with unclosed identity ticket rejects binding edits and reports unconfirmed', async () => {
  const f = await mainFixture();
  try {
    await f.startMain(); f.identity.state.stopFailures = 3;
    await assert.rejects(f.scope.stop(f.state.main!), { code: 'PROJECT_MAIN_CLEANUP_FAILED' });
    assert.equal((await f.spaces.runtime(f.id)).status, 'unconfirmed');
    await assert.rejects(f.spaces.save(f.id, { ...f.project, command: 'sleep 601' }), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
    await f.scope.stop(f.state.main!);
    await f.spaces.save(f.id, { ...f.project, command: 'sleep 601' });
  } finally { await f.spaces.close(); }
});
for (const field of ['command', 'remove-command', 'environment', 'secrets', 'runtimes', 'directory', 'network', 'services'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `next.command`, `next.environment`, `next.secrets`, `next.runtimes`, `next.directory`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `mainFixture`, `f.startMain`, `structuredClone`, `assert.rejects`.
   * 检查边界 / Checked boundaries: `assert.rejects(f.spaces.save(f.id, next), { code: 'PROJECT_MAIN_SCOPE_CHANGED' })`; `assert.equal((await f.spaces.config(f.id)).command, f.project.command)`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test(`main exited descendants prevent ${field} binding edits until a full stop`, async () => {
    const f = await mainFixture('exited');
    try {
      await f.startMain();
      const next: any = structuredClone(f.project);
      if (field === 'command') next.command = 'sleep 601';
      if (field === 'remove-command') next.command = '';
      if (field === 'environment') next.environment = { TOKEN: 'replacement' };
      if (field === 'secrets') next.secrets = { TOKEN: 'replacement-key' };
      if (field === 'runtimes') next.runtimes = { node: '22.1.0' };
      if (field === 'directory') next.directory = '/other';
      if (field === 'network') next.networkIsolation = 'host';
      if (field === 'services') next.services = [{ name: 'main', command: 'sleep 601' }];
      await assert.rejects(f.spaces.save(f.id, next), { code: 'PROJECT_MAIN_SCOPE_CHANGED' });
      assert.equal((await f.spaces.config(f.id)).command, f.project.command);
    } finally { await f.spaces.close(); }
  });
}
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: main runtime exposes exited at the top level, explicit main metadata and redacted application logs
 * 协作入口 / Collaborators: `mainFixture`, `f.startMain`, `f.spaces.runtime`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(runtime.status, 'exited')`; `assert.equal(runtime.main?.status, 'exited')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('main runtime exposes exited at the top level, explicit main metadata and redacted application logs', async () => {
  const f = await mainFixture('exited');
  try {
    await f.startMain();
    const runtime = await f.spaces.runtime(f.id);
    assert.equal(runtime.status, 'exited'); assert.equal(runtime.main?.status, 'exited');
    assert.equal(runtime.services, undefined); assert.match(runtime.log, /全部后代/); assert.match(runtime.log, /owned main application log/);
    assert.equal(runtime.log.includes('owned-main-private-token'), false);
  } finally { await f.spaces.close(); }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: main runtime rejects unverified root logs without changing the actual running ownership
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mainFixture`, `f.startMain`, `f.scope.metadata`, `f.spaces.runtime`.
 * 检查边界 / Checked boundaries: `assert.equal(runtime.status, 'unconfirmed')`; `assert.equal(runtime.main?.status, 'running')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('main runtime rejects unverified root logs without changing the actual running ownership', async () => {
  const f = await mainFixture();
  const execute = f.machines.exec;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: id; command; rest。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: main runtime rejects unverified root logs without changing the actual running ownership
   * 协作入口 / Collaborators: `command.startsWith`, `assert.match`, `assert.equal`, `command.includes`.
   * 检查边界 / Checked boundaries: `assert.match(command, /\/usr\/bin\/env -i .*\/usr\/bin\/python3 -I -S/)`; `assert.match(command, /O_NOFOLLOW/)`.
   */
  async (id, command, ...rest) => {
    if (command.startsWith('# SAKURA_PROJECT_RUNTIME_LOG')) {
      assert.match(command, /\/usr\/bin\/env -i .*\/usr\/bin\/python3 -I -S/);
      assert.match(command, /O_NOFOLLOW/); assert.match(command, /O_NONBLOCK/);
      assert.match(command, /os\.fstat\(descriptor\)/); assert.match(command, /info\.st_uid!=0/);
      assert.match(command, /info\.st_nlink!=1/); assert.match(command, /stat\.S_IMODE\(info\.st_mode\)!=0o600/);
      assert.match(command, /limit=16384/); assert.equal(command.includes('owned-main-private-token'), false);
      return { code: 73, stdout: '', stderr: 'owned-main-private-token log identity refused' };
    }
    return execute.call(f.machines, id, command, ...rest);
  };
  try {
    await f.startMain();
    const before = await f.scope.metadata(), runtime = await f.spaces.runtime(f.id);
    assert.equal(runtime.status, 'unconfirmed'); assert.equal(runtime.main?.status, 'running');
    assert.match(runtime.log, /日志读取未确认/); assert.match(runtime.log, /log identity refused/);
    assert.equal(runtime.log.includes('owned-main-private-token'), false);
    assert.deepEqual(await f.scope.metadata(), before);
  } finally { await f.spaces.close(); }
});
for (const status of ['prepared', 'unconfirmed']) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `f.state.main!.phase`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `mainFixture`, `f.startMain`, `writeStore`, `f.scope.receipt`.
   * 检查边界 / Checked boundaries: `assert.equal(runtime.status, 'unconfirmed')`; `assert.equal(runtime.main?.status, status)`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test(`main ${status} status is unconfirmed at the top level and preserves diagnostic logs`, async () => {
    const f = await mainFixture(status === 'unconfirmed' ? 'unconfirmed' : 'normal');
    try {
      await f.startMain();
      if (status === 'prepared') { f.state.main!.phase = 'prepared'; await writeStore(f.scope.receipt(), f.state.main); }
      const runtime = await f.spaces.runtime(f.id);
      assert.equal(runtime.status, 'unconfirmed'); assert.equal(runtime.main?.status, status);
      assert.match(runtime.log, /owned main application log/); assert.equal(runtime.log.includes('owned-main-private-token'), false);
    } finally { await f.spaces.close(); }
  });
}
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy main runtime exposes migration metadata without Python probes or inferred termination
 * 协作入口 / Collaborators: `mainFixture`, `f.spaces.runtime`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(runtime.status, 'unconfirmed')`; `assert.equal(runtime.main?.status, 'unmanaged')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('legacy main runtime exposes migration metadata without Python probes or inferred termination', async () => {
  const f = await mainFixture('legacy');
  try {
    const runtime = await f.spaces.runtime(f.id);
    assert.equal(runtime.status, 'unconfirmed'); assert.equal(runtime.main?.status, 'unmanaged'); assert.match(runtime.log, /管理员/);
    await assert.rejects(f.spaces.save(f.id, { ...f.project, command: 'sleep 601' }), { code: 'PROJECT_MAIN_SCOPE_UNMANAGED' });
    assert.equal(f.commands.some(command => /python3|apk add|apt-get|kill-session/.test(command)), false);
    assert.equal(f.commands.some(command => /tail -c|SAKURA_PROJECT_RUNTIME_LOG/.test(command)), false);
  } finally { await f.spaces.close(); }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: confirmed stopped main permits binding edits and switching to an independently named service
 * 协作入口 / Collaborators: `mainFixture`, `f.startMain`, `f.scope.stop`, `f.spaces.save`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.spaces.config(f.id)).services?.[0].name, 'main')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('confirmed stopped main permits binding edits and switching to an independently named service', async () => {
  const f = await mainFixture();
  try {
    await f.startMain();
    await f.scope.stop(f.state.main!);
    await f.spaces.save(f.id, { ...f.project, command: 'sleep 601', directory: '/other', networkIsolation: 'host',
      services: [{ name: 'main', command: 'sleep 600' }] });
    assert.equal((await f.spaces.config(f.id)).services?.[0].name, 'main');
  } finally { await f.spaces.close(); }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: main cleanup failure remains an error Job, redacts keys and prevents namespace removal after services stop
 * 协作入口 / Collaborators: `mainFixture`, `f.startMain`, `serviceSchema.parse`, `f.startService`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('main cleanup failure remains an error Job, redacts keys and prevents namespace removal after services stop', async () => {
  const f = await mainFixture('all-stop-failures');
  try {
    await f.startMain();
    const service = serviceSchema.parse({ name: 'main', command: 'sleep 600' });
    const services = new ProjectServiceScopes(f.machines, f.id, f.project);
    await f.startService(services, services.intent(service, f.bootId));
    await f.saveConfig({ ...f.project, services: [service] });
    const job = await f.spaces.run(f.id, 'stop');
    await f.spaces.jobs.wait(f.spaces.projects.key(f.id));
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED');
    assert.equal(job.error!.includes('owned-main-private-token'), false); assert.equal(job.log.includes('owned-main-private-token'), false);
    assert.equal(f.state.services.get('main')?.phase, 'stopped'); assert.equal(f.state.main?.phase, 'running');
    assert.equal(f.state.namespaceRemovals, 0); assert.equal(JSON.parse(await readFile(f.scope.receipt(), 'utf8')).phase, 'running');
  } finally { await f.spaces.close(); }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: named service stop leaves main ownership and network namespace intact
 * 协作入口 / Collaborators: `mainFixture`, `f.startMain`, `serviceSchema.parse`, `f.startService`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done')`; `assert.equal(f.state.main?.phase, 'running')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('named service stop leaves main ownership and network namespace intact', async () => {
  const f = await mainFixture();
  try {
    await f.startMain();
    const service = serviceSchema.parse({ name: 'main', command: 'sleep 600' }), services = new ProjectServiceScopes(f.machines, f.id, f.project);
    await f.startService(services, services.intent(service, f.bootId));
    await f.saveConfig({ ...f.project, services: [service] });
    const job = await f.spaces.run(f.id, 'stop', 'main');
    await f.spaces.jobs.wait(f.spaces.projects.key(f.id));
    assert.equal(job.status, 'done'); assert.equal(f.state.main?.phase, 'running');
    assert.equal(f.events.some(event => event.kind === 'main' && event.op === 'stop'), false);
    assert.equal(f.state.namespaceRemovals, 0);
  } finally { await f.spaces.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: whole-project stop freezes the original network before either scope cleanup and uses its exact release
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mainFixture`, `f.startMain`, `serviceSchema.parse`, `f.startService`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done', job.error)`; `assert.equal(checkedStops, 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('whole-project stop freezes the original network before either scope cleanup and uses its exact release', async () => {
  const f = await mainFixture();
  try {
    await f.startMain();
    const service = serviceSchema.parse({ name: 'main', command: 'sleep 600' }), services = new ProjectServiceScopes(f.machines, f.id, f.project);
    await f.startService(services, services.intent(service, f.bootId)); await f.saveConfig({ ...f.project, services: [service] });
    const original = f.identity.networks.get('default')!, exec = f.machines.exec; let checkedStops = 0;
    f.machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`exec(...args)`），以 Promise 交付。
     * Result: Return the branch-computed value (`exec(...args)`) through a Promise.
     * 验证场景 / Scenario: whole-project stop freezes the original network before either scope cleanup and uses its exact release
     * 协作入口 / Collaborators: `scopeRequest`, `assert.equal`, `exec`.
     * 检查边界 / Checked boundaries: `assert.equal(f.identity.networkLeases.size, 1)`.
     */
    async (...args) => {
      if (scopeRequest(args[1])?.op === 'stop') { ++checkedStops; assert.equal(f.identity.networkLeases.size, 1); }
      return exec(...args);
    };
    const job = await f.spaces.run(f.id, 'stop'); await f.spaces.jobs.wait(f.spaces.projects.key(f.id));
    assert.equal(job.status, 'done', job.error); assert.equal(checkedStops, 2);
    assert.equal(f.identity.state.networkReleaseCalls, 1); assert.equal(f.state.namespaceRemovals, 0);
    assert.deepEqual([...f.identity.releasedNetworks.values()][0].network, original);
    const { vmDir } = await import('../server/model.ts');
    const journal = JSON.parse(await readFile(join(vmDir(f.id), 'project-identities/default.json'), 'utf8'));
    assert.equal(journal.networkRelease.phase, 'released'); assert.equal(journal.runs.every((run: any) => run.phase === 'closed'), true);
  } finally { await f.spaces.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unconfirmed network release blocks root preparation until retry closes the original request
 * 状态影响 / State effects: `f.identity.state.networkReleaseFailures`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mainFixture`, `f.startMain`, `f.spaces.run`, `f.spaces.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(stopped.status, 'error')`; `assert.equal(stopped.errorCode, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('unconfirmed network release blocks root preparation until retry closes the original request', async () => {
  const f = await mainFixture();
  try {
    await f.startMain(); f.identity.state.networkReleaseFailures = 1;
    const stopped = await f.spaces.run(f.id, 'stop'); await f.spaces.jobs.wait(f.spaces.projects.key(f.id));
    assert.equal(stopped.status, 'error'); assert.equal(stopped.errorCode, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
    assert.equal(stopped.error!.includes('owned-main-private-token'), false); assert.equal(f.state.main!.phase, 'stopped');
    const captured = [...f.identity.networkLeases.values()][0], count = f.commands.length;
    const started = await f.spaces.run(f.id, 'start'); await f.spaces.jobs.wait(f.spaces.projects.key(f.id));
    assert.equal(started.status, 'error'); assert.equal(started.errorCode, 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING');
    assert.equal(f.commands.length, count, 'Pending release must reject before package installation or namespace creation.');
    const retry = await f.spaces.run(f.id, 'stop'); await f.spaces.jobs.wait(f.spaces.projects.key(f.id));
    assert.equal(retry.status, 'done', retry.error); assert.equal(f.identity.networkLeases.size, 1);
    assert.deepEqual(f.identity.releasedNetworks.get(captured.releaseId)!.network, captured.network);
    assert.equal(f.state.namespaceRemovals, 0);
  } finally { await f.spaces.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private-to-host configuration releases account network ownership without legacy deletion
 * 协作入口 / Collaborators: `mainFixture`, `f.startMain`, `f.scope.stop`, `f.identity.networks.get`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.spaces.config(f.id)).networkIsolation, 'host')`; `assert.equal(f.state.namespaceRemovals, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('private-to-host configuration releases account network ownership without legacy deletion', async () => {
  const f = await mainFixture();
  try {
    await f.startMain(); await f.scope.stop(f.state.main!);
    const generation = f.identity.networks.get('default')!.generation;
    await f.spaces.save(f.id, { ...f.project, networkIsolation: 'host' });
    assert.equal((await f.spaces.config(f.id)).networkIsolation, 'host'); assert.equal(f.state.namespaceRemovals, 0);
    assert.equal([...f.identity.releasedNetworks.values()][0].network.generation, generation);
  } finally { await f.spaces.close(); }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: main startup acknowledgment failure retains its own Job error code and redacts resolved secrets
 * 协作入口 / Collaborators: `mainFixture`, `f.spaces.run`, `f.spaces.jobs.wait`, `f.spaces.projects.key`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.errorCode, 'PROJECT_MAIN_SCOPE_CHANGED')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('main startup acknowledgment failure retains its own Job error code and redacts resolved secrets', async () => {
  const f = await mainFixture('commit-ack-lost');
  try {
    const job = await f.spaces.run(f.id, 'start');
    await f.spaces.jobs.wait(f.spaces.projects.key(f.id));
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_MAIN_SCOPE_CHANGED');
    assert.equal(f.state.main?.phase, 'stopped'); assert.equal(job.error!.includes('owned-main-private-token'), false);
    assert.equal(job.log.includes('owned-main-private-token'), false);
  } finally { await f.spaces.close(); }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: main cancelled startup with failed cleanup is reported with the retained cleanup recovery code
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mainFixture`, `f.spaces.run`, `f.spaces.jobs.wait`, `f.spaces.projects.key`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('main cancelled startup with failed cleanup is reported with the retained cleanup recovery code', async () => {
  const f = await mainFixture('cancel-cleanup-failed');
  const execute = f.machines.exec;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: id; command; timeout; signal; output; agent。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: main cancelled startup with failed cleanup is reported with the retained cleanup recovery code
   * 协作入口 / Collaborators: `execute.call`, `command.startsWith`, `f.spaces.jobs.cancel`, `f.spaces.projects.key`.
   */
  async (id, command, timeout, signal, output, agent) => {
    const result = await execute.call(f.machines, id, command, timeout, signal, output, agent);
    if (command.startsWith('# SAKURA_PROJECT_MAIN_COMMIT')) f.spaces.jobs.cancel(f.spaces.projects.key(f.id));
    return result;
  };
  try {
    const job = await f.spaces.run(f.id, 'start');
    await f.spaces.jobs.wait(f.spaces.projects.key(f.id));
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED');
    assert.equal(f.state.main?.phase, 'running'); assert.equal(job.error!.includes('owned-main-private-token'), false);
    assert.equal(job.log.includes('owned-main-private-token'), false);
  } finally { await f.spaces.close(); }
});

for (const field of ['command', 'environment', 'secrets', 'runtimes', 'directory', 'network', 'services'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `next.command`, `next.environment`, `next.secrets`, `next.runtimes`, `next.directory`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `mainFixture`, `f.saveConfig`, `structuredClone`, `assert.rejects`.
   * 检查边界 / Checked boundaries: `assert.rejects(f.spaces.save(f.id, next), { code: 'PROJECT_MAIN_SCOPE_UNMANAGED' })`; `assert.equal((await f.spaces.config(f.id)).command, '')`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test(`an empty saved command cannot exempt an unknown legacy main from the ${field} guard`, async () => {
    const f = await mainFixture('legacy');
    try {
      const blank = { ...f.project, command: '' }; await f.saveConfig(blank);
      const next: any = structuredClone(blank);
      if (field === 'command') next.command = 'sleep 601';
      if (field === 'environment') next.environment = {};
      if (field === 'secrets') next.secrets = {};
      if (field === 'runtimes') next.runtimes = { node: '22.1.0' };
      if (field === 'directory') next.directory = '/other';
      if (field === 'network') next.networkIsolation = 'host';
      if (field === 'services') next.services = [{ name: 'api', command: 'sleep 600' }];
      await assert.rejects(f.spaces.save(f.id, next), { code: 'PROJECT_MAIN_SCOPE_UNMANAGED' });
      assert.equal((await f.spaces.config(f.id)).command, '');
      assert.equal(f.commands.some(command => /python3|apk add|apt-get|kill-session/.test(command)), false);
      f.state.machine = 'paused'; const calls = f.commands.length;
      await assert.rejects(f.spaces.save(f.id, next), { code: 'PROJECT_MAIN_SCOPE_CHANGED' });
      assert.equal(f.commands.length, calls);
    } finally { await f.spaces.close(); }
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: paused projects with confirmed stopped main and service receipts permit service mode edits
 * 状态影响 / State effects: `f.state.machine`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mainFixture`, `f.startMain`, `f.scope.stop`, `serviceSchema.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(f.commands.length, calls)`; `assert.equal((await f.spaces.config(f.id)).services?.length, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('paused projects with confirmed stopped main and service receipts permit service mode edits', async () => {
  const f = await mainFixture();
  try {
    await f.startMain(); await f.scope.stop(f.state.main!);
    const service = serviceSchema.parse({ name: 'api', command: 'sleep 600' }), services = new ProjectServiceScopes(f.machines, f.id, f.project);
    await f.startService(services, services.intent(service, f.bootId)); await services.stop(f.state.services.get('api')!);
    await f.saveConfig({ ...f.project, services: [service] }); f.state.machine = 'paused'; const calls = f.commands.length;
    await f.spaces.save(f.id, { ...f.project, services: [], environment: {}, secrets: {}, command: '' });
    assert.equal(f.commands.length, calls); assert.equal((await f.spaces.config(f.id)).services?.length, 0);
  } finally { await f.spaces.close(); }
});
