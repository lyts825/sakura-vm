/**
 * 模块职责：回归验证模块，围绕 `project-services-scope` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-services-scope`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: service scope persists after readiness and repeated stop is idempotent; legacy service v1 may stop but cannot reuse a root execution entry.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Machines } from '../server/machines.ts';
import type { ProjectServiceRecord } from '../server/project-service-scope.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-service-scope-test-'));
process.env.SAKURA_DATA_DIR = root;
const { runServices, serviceSchema } = await import('../server/project-services.ts');
const { projectSchema } = await import('../server/workspaces.ts');
const { ProjectServiceScopes, projectServiceRecordSchema } = await import('../server/project-service-scope.ts');
const { writeStore } = await import('../server/local-store.ts');
const { scopeIdentityFixture } = await import('./project-scope-identity-fixture.ts');
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), await realpath(tmpdir()));
  assert.match(basename(owned), /^sakura-project-service-scope-test-/);
  await rm(owned, { recursive: true, force: true });
});

/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: command: string。
 * 结果：返回分支计算值（`encoded ? JSON.parse(Buffer.from(encoded.split('=')[1], 'base64').toString()) : …`）。
 * Result: Return the branch-computed value (`encoded ? JSON.parse(Buffer.from(encoded.split('=')[1], 'base64').toString()) : …`).
 * 协作入口 / Collaborators: `command.split('\n').find`, `command.split`, `JSON.parse`, `Buffer.from(encoded.split('=')[1], 'base64').toString`.
 */
function request(command: string) {
  const encoded = command.split('\n').find(line => line.startsWith('# SAKURA_PROJECT_SERVICE_REQUEST='));
  return encoded ? JSON.parse(Buffer.from(encoded.split('=')[1], 'base64').toString()) : null;
}
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: mode = 'normal'。
 * 结果：返回受控对象，公开字段包括 `id, bootId, project, machines, records, events, controller, identity, state`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, bootId, project, machines, records, events, controller, identity, state`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `projectSchema.parse`, `scopeIdentityFixture`.
 */
function fixture(mode = 'normal') {
  const id = randomUUID(), bootId = randomUUID(), instance = {}, records = new Map<string, ProjectServiceRecord>();
  const project = projectSchema.parse({ directory: '/workspace', services: [
    { name: 'db', command: 'sleep 600' },
    { name: 'api', command: 'sleep 600', dependsOn: ['db'], ready: 'ready-probe', timeout: 5 },
  ] });
  const events: { op: string; name: string; runId: string | null }[] = [];
  let stops = 0, commits = 0, sequence = 0;
  const state = { currentBoot: bootId, rebootProbes: 0, rebootBlock: '', rebootProbeFailures: 0 };
  const controller = new AbortController();
  const machines = {
    live: new Map([[id, instance]]), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ distro: 'alpine' })`）。
     * Result: Return the branch-computed value (`({ distro: 'alpine' })`).
     */
    get: () => ({ distro: 'alpine' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _key: string; action: () => Promise<unknown>。
     * 结果：返回分支计算值（`action()`），以 Promise 交付。
     * Result: Return the branch-computed value (`action()`) through a Promise.
     * 协作入口 / Collaborators: `action`.
     */
    locked: async (_key: string, action: /**
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
     * 失败 / Failure: `new Error('owned reboot probe connection failed')`; `new Error('owned prepare acknowledgement lost')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `request`, `command.includes`, `events.push`, `records.has`.
     * 检查边界 / Checked boundaries: `assert.equal(host.runId, input.record.runId)`; `assert.equal(host.phase, 'intent', 'host intent must exist before guest prepares')`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    exec: async (_id: string, command: string) => {
      const input = request(command);
      if (!input) return { code: command.includes('# SAKURA_GUEST_TASK_RUN') && command.includes('ready-probe') && mode === 'ready-failure' ? 1 : 0, stdout: '', stderr: '' };
      const { op, name } = input;
      events.push({ op, name, runId: input.record?.runId || null });
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: status: string; record: ProjectServiceRecord | null。
       * 结果：返回分支计算值（`({ code: 0, stdout: JSON.stringify({ status, bootId: state.currentBoot, record }…`）。
       * Result: Return the branch-computed value (`({ code: 0, stdout: JSON.stringify({ status, bootId: state.currentBoot, record }…`).
       * 协作入口 / Collaborators: `JSON.stringify`.
       */
      const reply = (status: string, record: ProjectServiceRecord | null) => ({ code: 0, stdout: JSON.stringify({ status, bootId: state.currentBoot, record }), stderr: '' });
      if (op === 'probe-reboot') {
        if (++state.rebootProbes <= state.rebootProbeFailures) throw new Error('owned reboot probe connection failed');
        if (state.currentBoot !== input.record.bootId && (state.rebootBlock || records.has(name)))
          return { code: 73, stdout: '', stderr: state.rebootBlock || 'new boot service owner exists' };
        return { code: 0, stdout: JSON.stringify({ bootId: state.currentBoot, retired: state.currentBoot !== input.record.bootId }), stderr: '' };
      }
      if (op === 'status') {
        if (mode === 'unmanaged') return reply('unmanaged', null);
        const record = records.get(name);
        return reply(record?.phase === 'running' && mode === 'exited-pane' ? 'exited' : record?.phase || 'absent', record || null);
      }
      const scopes = new ProjectServiceScopes(machines as unknown as Machines, id, project);
      if (op === 'prepare') {
        const host = JSON.parse(await readFile(scopes.receipt(name), 'utf8'));
        assert.equal(host.runId, input.record.runId);
        assert.equal(host.phase, 'intent', 'host intent must exist before guest prepares');
        if (mode === 'scope-unavailable') return { code: 73, stdout: '', stderr: 'SAKURA_SERVICE_SCOPE_UNAVAILABLE: readonly cgroup' };
        const record = { ...input.record, phase: 'prepared', inode: '1000' + ++sequence } as ProjectServiceRecord;
        records.set(name, record);
        if (mode === 'prepare-ack-lost') throw new Error('owned prepare acknowledgement lost');
        return reply('prepared', record);
      }
      if (op === 'start') {
        const record = { ...records.get(name)!, sessionId: '$' + sequence, paneId: '%' + sequence,
          panePid: 100 + sequence, paneStartTicks: '999' + sequence };
        records.set(name, record);
        if (mode === 'pane-failure') throw new Error('owned pane launch failed');
        return reply('prepared', record);
      }
      if (op === 'commit') {
        ++commits;
        const host = JSON.parse(await readFile(scopes.receipt(name), 'utf8'));
        assert.equal(host.panePid, records.get(name)!.panePid);
        assert.equal(host.inode, records.get(name)!.inode);
        assert.equal(host.phase, 'prepared', 'full host pane identity must exist before project code');
        const record = { ...records.get(name)!, phase: 'running' as const };
        records.set(name, record);
        if (mode === 'commit-ack-lost') throw new Error('owned commit acknowledgement lost');
        if (mode === 'cancel-after-commit') controller.abort(new Error('owned cancellation'));
        return reply('running', record);
      }
      assert.equal(op, 'stop');
      ++stops;
      if ((mode === 'first-stop-failure' && stops === 1) || mode === 'all-stop-failures')
        throw new Error('owned cleanup connection failed');
      if (mode === 'replace-live') {
        machines.live.set(id, {});
        throw new Error('owned live replacement');
      }
      const record = records.get(name);
      if (record && record.runId !== input.record.runId)
        return { code: 73, stdout: '', stderr: '服务 run 身份已改变' };
      const stopped = { ...(record || input.record), phase: 'stopped' as const };
      records.set(name, stopped);
      if (mode === 'stop-ack-lost' && stops === 1) throw new Error('owned stop reply lost');
      return reply('stopped', stopped);
    },
  };
  const identity = scopeIdentityFixture(machines as unknown as Machines, project, () => state.currentBoot,
    runId => [...records.values()].find(item => item.runId === runId) || null,
    execution => mode === 'ready-failure' && execution.command === 'ready-probe' ? 1 : 0);
  return { id, bootId, project, machines: machines as unknown as Machines, records, events, controller, identity, state,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: record: ProjectServiceRecord。
     * 结果：返回分支计算值（`scopes.start(record, await identity.payload(id, record, { command: 'sleep 600' }…`），以 Promise 交付。
     * Result: Return the branch-computed value (`scopes.start(record, await identity.payload(id, record, { command: 'sleep 600' }…`) through a Promise.
     * 协作入口 / Collaborators: `scopes.persistIntent`, `scopes.start`, `identity.payload`.
     */
    startService: async (record: ProjectServiceRecord) => {
      const scopes = new ProjectServiceScopes(machines as unknown as Machines, id, project);
      await scopes.persistIntent(record);
      return scopes.start(record, await identity.payload(id, record, { command: 'sleep 600' }), controller.signal);
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ stops, commits })`）。
     * Result: Return the branch-computed value (`({ stops, commits })`).
     */
    counts: () => ({ stops, commits }), /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`new ProjectServiceScopes(machines as unknown as Machines, id, project)`）。
     * Result: Return the branch-computed value (`new ProjectServiceScopes(machines as unknown as Machines, id, project)`).
     */
    scopes: () => new ProjectServiceScopes(machines as unknown as Machines, id, project) };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: service scope persists after readiness and repeated stop is idempotent
 * 协作入口 / Collaborators: `fixture`, `runServices`, `assert.equal`, `f.records.get`.
 * 检查边界 / Checked boundaries: `assert.equal(f.records.get('api')?.phase, 'running')`; `assert.equal(f.records.get('db')?.phase, 'running')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('service scope persists after readiness and repeated stop is idempotent', async () => {
  const f = fixture();
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'api');
  assert.equal(f.records.get('api')?.phase, 'running');
  assert.equal(f.records.get('db')?.phase, 'running');
  assert.equal(f.counts().stops, 0);
  assert.equal(f.counts().commits, 2);
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal);
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal);
  assert.equal(f.records.get('api')?.phase, 'stopped');
  assert.equal(f.records.get('db')?.phase, 'stopped');
  assert.equal(f.counts().stops, 4);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy service v1 may stop but cannot reuse a root execution entry
 * 协作入口 / Collaborators: `fixture`, `f.scopes`, `scope.intent`, `f.records.set`.
 * 检查边界 / Checked boundaries: `assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db'), { code: 'SERVICE_IDENTITY_R…`; `assert.equal(f.counts().commits, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('legacy service v1 may stop but cannot reuse a root execution entry', async () => {
  const f = fixture(), scope = f.scopes();
  const record = { ...scope.intent(f.project.services![0], f.bootId), phase: 'running' as const, inode: '555',
    sessionId: '$1', paneId: '%1', panePid: 100, paneStartTicks: '1234' };
  f.records.set('db', record); await writeStore(scope.receipt('db'), record);
  await assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db'),
    { code: 'SERVICE_IDENTITY_REQUIRED' });
  assert.equal(f.counts().commits, 0);
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db');
  assert.equal(f.records.get('db')!.phase, 'stopped'); assert.equal(f.identity.state.stopCalls, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: service ready uses protected task input and identity closure retries before scope retirement
 * 状态影响 / State effects: `f.identity.state.stopFailures`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `runServices`, `assert.ok`, `f.identity.inputs.some`.
 * 检查边界 / Checked boundaries: `assert.ok(f.identity.inputs.some(input => input.includes(Buffer.from('ready-probe'))))`; `assert.equal(f.records.get('api')!.phase, 'stopped')`.
 */
test('service ready uses protected task input and identity closure retries before scope retirement', async () => {
  const f = fixture();
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'api');
  assert.ok(f.identity.inputs.some(input => input.includes(Buffer.from('ready-probe'))));
  f.identity.state.stopFailures = 1;
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal);
  assert.equal(f.records.get('api')!.phase, 'stopped'); assert.equal(f.records.get('db')!.phase, 'stopped');
  assert.ok(f.identity.state.stopCalls >= 4);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a cold reboot retires the exact absent service and its identity without ordinary stop signals
 * 状态影响 / State effects: `f.state.currentBoot`, `f.state.rebootProbeFailures`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `runServices`, `f.records.get`, `f.records.clear`.
 * 检查边界 / Checked boundaries: `assert.equal(f.counts().stops, 0)`; `assert.equal(f.state.rebootProbes, 3)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a cold reboot retires the exact absent service and its identity without ordinary stop signals', async () => {
  const f = fixture();
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
  const old = { ...f.records.get('db')! }; f.records.clear(); f.state.currentBoot = randomUUID();
  f.state.rebootProbeFailures = 1;
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db');
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db');
  assert.equal(f.counts().stops, 0); assert.equal(f.state.rebootProbes, 3);
  assert.deepEqual(await f.scopes().metadata('db'), { ...old, phase: 'stopped' });
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
  assert.notEqual(f.records.get('db')!.runId, old.runId); assert.equal(f.records.get('db')!.bootId, f.state.currentBoot);
});
for (const replacement of ['new guest owner', 'replacement cgroup', 'replacement pane'])
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `f.state.currentBoot`, `f.state.rebootBlock`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `fixture`, `runServices`, `readFile`, `f.scopes().receipt`.
   * 检查边界 / Checked boundaries: `assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'), { code: 'SERVICE_CLEANUP_FAI…`; `assert.equal(f.counts().stops, 0)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test(`cross-boot service retirement refuses ${replacement} and retains the exact host record`, async () => {
    const f = fixture();
    await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
    const before = await readFile(f.scopes().receipt('db'), 'utf8'); f.records.clear();
    f.state.currentBoot = randomUUID(); f.state.rebootBlock = replacement;
    await assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'), { code: 'SERVICE_CLEANUP_FAILED' });
    assert.equal(f.counts().stops, 0); assert.equal(await readFile(f.scopes().receipt('db'), 'utf8'), before);
  });
for (const mode of ['prepare-ack-lost', 'pane-failure', 'commit-ack-lost', 'cancel-after-commit', 'scope-unavailable']) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `runServices`, `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db'))`; `assert.equal(f.counts().stops, 1)`.
   */
  test(`service ${mode} rolls back only the known new run and retains a stopped receipt`, async () => {
    const f = fixture(mode);
    await assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db'));
    assert.equal(f.counts().stops, 1);
    assert.equal(f.records.get('db')?.phase, 'stopped');
    const saved = JSON.parse(await readFile(f.scopes().receipt('db'), 'utf8'));
    assert.equal(projectServiceRecordSchema.safeParse(saved).success, true);
    assert.equal(saved.runId, f.events.find(event => event.op === 'prepare')!.runId);
  });
}
for (const mode of ['first-stop-failure', 'stop-ack-lost']) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixture`, `runServices`, `assert.equal`, `f.counts`.
   * 检查边界 / Checked boundaries: `assert.equal(f.counts().stops, 2)`; `assert.equal(f.records.get('db')?.phase, 'stopped')`.
   */
  test(`service ${mode} retries independently and confirms whole-scope stop`, async () => {
    const f = fixture(mode);
    await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
    await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db');
    assert.equal(f.counts().stops, 2);
    assert.equal(f.records.get('db')?.phase, 'stopped');
  });
}
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: all stop connections failing retains the running receipt and reports cleanup failure
 * 协作入口 / Collaborators: `fixture`, `runServices`, `readFile`, `f.scopes().receipt`.
 * 检查边界 / Checked boundaries: `assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'), (error: any) => error.code =…`; `assert.equal(f.counts().stops, 3)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('all stop connections failing retains the running receipt and reports cleanup failure', async () => {
  const f = fixture('all-stop-failures');
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
  const before = await readFile(f.scopes().receipt('db'), 'utf8');
  await assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'),
    (error: any) => error.code === 'SERVICE_CLEANUP_FAILED' && error.status === 503);
  assert.equal(f.counts().stops, 3);
  assert.equal(await readFile(f.scopes().receipt('db'), 'utf8'), before);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an exited main pane still owns detached children and permits a verified full-scope stop
 * 协作入口 / Collaborators: `fixture`, `f.scopes`, `scopes.intent`, `f.startService`.
 * 检查边界 / Checked boundaries: `assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db'), /主 pane 已退出/)`; `assert.equal(f.counts().stops, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('an exited main pane still owns detached children and permits a verified full-scope stop', async () => {
  const f = fixture('exited-pane'), scopes = f.scopes(), service = f.project.services![0];
  const record = scopes.intent(service, f.bootId);
  await f.startService(record);
  await assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db'), /主 pane 已退出/);
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db');
  assert.equal(f.counts().stops, 1);
  assert.equal(f.records.get('db')?.phase, 'stopped');
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an exited dependent still blocks stopping its dependency until its owned descendants are cleaned
 * 协作入口 / Collaborators: `fixture`, `f.scopes`, `f.startService`, `scopes.intent`.
 * 检查边界 / Checked boundaries: `assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'), /请先停止依赖服务 api/)`; `assert.equal(f.counts().stops, 0)`.
 */
test('an exited dependent still blocks stopping its dependency until its owned descendants are cleaned', async () => {
  const f = fixture('exited-pane'), scopes = f.scopes();
  await f.startService(scopes.intent(f.project.services![1], f.bootId));
  await assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'), /请先停止依赖服务 api/);
  assert.equal(f.counts().stops, 0);
  assert.equal(f.records.get('api')?.phase, 'running');
});
for (const mode of ['prepare-ack-lost', 'pane-failure']) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixture`, `f.scopes`, `assert.rejects`, `f.startService`.
   * 检查边界 / Checked boundaries: `assert.rejects(f.startService(scopes.intent(f.project.services![0], f.bootId)))`; `assert.equal(f.counts().stops, 1)`.
   */
  test(`manual stop recovers a durable partial host receipt after ${mode} and a lost caller`, async () => {
    const f = fixture(mode), scopes = f.scopes();
    await assert.rejects(f.startService(scopes.intent(f.project.services![0], f.bootId)));
    await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db');
    assert.equal(f.counts().stops, 1);
    assert.equal(f.records.get('db')?.phase, 'stopped');
  });
}
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: service cleanup refuses a changed live instance after the first failed connection
 * 协作入口 / Collaborators: `fixture`, `runServices`, `assert.rejects`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'), { code: 'SERVICE_CLEANUP_FAI…`; `assert.equal(f.counts().stops, 1)`.
 */
test('service cleanup refuses a changed live instance after the first failed connection', async () => {
  const f = fixture('replace-live');
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
  await assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'), { code: 'SERVICE_CLEANUP_FAILED' });
  assert.equal(f.counts().stops, 1);
});
for (const field of ['runId', 'bootId', 'inode', 'panePid', 'paneStartTicks'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `(record as any)[field]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `fixture`, `runServices`, `f.records.get`, `field.endsWith`.
   * 检查边界 / Checked boundaries: `assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'), { code: 'SERVICE_SCOPE_CHANG…`; `assert.equal(f.counts().stops, 0)`.
   */
  test(`service refuses replaced ${field} against the persisted host receipt before signaling`, async () => {
    const f = fixture();
    await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
    const record = f.records.get('db')!;
    (record as any)[field] = field.endsWith('Id') ? randomUUID() : field === 'panePid' ? record.panePid! + 1 : '555555';
    await assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'), { code: 'SERVICE_SCOPE_CHANGED' });
    assert.equal(f.counts().stops, 0);
  });
}
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unknown old tmux sessions are never guessed into a service scope or stopped
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `runServices`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(runServices(f.machines, f.id, f.project, action, () => {}, f.controller.signal, 'db'), { code: 'SERVICE_SCOPE_UNMAN…`; `assert.equal(f.events.filter(event => event.op !== 'status').length, 0)`.
 */
test('unknown old tmux sessions are never guessed into a service scope or stopped', async () => {
  const f = fixture('unmanaged');
  for (const action of ['start', 'stop'] as const)
    await assert.rejects(runServices(f.machines, f.id, f.project, action, () => {}, f.controller.signal, 'db'), { code: 'SERVICE_SCOPE_UNMANAGED' });
  assert.equal(f.events.filter(event => event.op !== 'status').length, 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a failed dependent readiness check leaves the previously running dependency alone
 * 协作入口 / Collaborators: `fixture`, `runServices`, `f.records.get`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'api'), /就绪检查超时/)`; `assert.deepEqual(f.records.get('db'), dependency)`.
 */
test('a failed dependent readiness check leaves the previously running dependency alone', async () => {
  const f = fixture('ready-failure');
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
  const dependency = { ...f.records.get('db')! };
  await assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'api'), /就绪检查超时/);
  assert.deepEqual(f.records.get('db'), dependency);
  assert.equal(f.records.get('api')?.phase, 'stopped');
  assert.deepEqual(f.events.filter(event => event.op === 'stop').map(event => event.name), ['api']);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an old rollback cannot overwrite the host receipt for a newer run
 * 状态影响 / State effects: `current.scopeName`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `runServices`, `f.records.get`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes().stop(old), { code: 'SERVICE_CLEANUP_FAILED' })`; `assert.equal(f.counts().stops, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('an old rollback cannot overwrite the host receipt for a newer run', async () => {
  const f = fixture();
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
  const old = { ...f.records.get('db')! }, current = { ...old, runId: randomUUID() };
  current.scopeName = 'sakura-service-' + current.runId;
  await writeFile(f.scopes().receipt('db'), JSON.stringify(current));
  await assert.rejects(f.scopes().stop(old), { code: 'SERVICE_CLEANUP_FAILED' });
  assert.equal(f.counts().stops, 0);
  assert.equal(JSON.parse(await readFile(f.scopes().receipt('db'), 'utf8')).runId, current.runId);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: service scope protocol rejects mismatched fixed paths and incomplete pane identities
 * 协作入口 / Collaborators: `fixture`, `serviceSchema.parse`, `f.scopes().intent`, `f.scopes`.
 * 检查边界 / Checked boundaries: `assert.equal(projectServiceRecordSchema.safeParse(intent).success, true)`; `assert.equal(projectServiceRecordSchema.safeParse({ ...intent, scopeName: 'sakura-service-' + randomUUID() }).success, false)`.
 */
test('service scope protocol rejects mismatched fixed paths and incomplete pane identities', () => {
  const f = fixture(), service = serviceSchema.parse({ name: 'api', command: 'sleep 600' });
  const intent = f.scopes().intent(service, randomUUID());
  assert.equal(projectServiceRecordSchema.safeParse(intent).success, true);
  assert.equal(projectServiceRecordSchema.safeParse({ ...intent, scopeName: 'sakura-service-' + randomUUID() }).success, false);
  assert.equal(projectServiceRecordSchema.safeParse({ ...intent, panePid: 100 }).success, false);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a same-boot durable intent without a guest receipt remains unconfirmed until a stop fences delayed prepare
 * 协作入口 / Collaborators: `fixture`, `f.scopes`, `scopes.intent`, `writeStore`.
 * 检查边界 / Checked boundaries: `assert.equal((await scopes.status('db')).status, 'unconfirmed')`; `assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db'), /上次启动尚未确认/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a same-boot durable intent without a guest receipt remains unconfirmed until a stop fences delayed prepare', async () => {
  const f = fixture(), scopes = f.scopes(), intent = scopes.intent(f.project.services![0], f.bootId);
  await writeStore(scopes.receipt('db'), intent);
  assert.equal((await scopes.status('db')).status, 'unconfirmed');
  await assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db'), /上次启动尚未确认/);
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db');
  assert.equal((await scopes.status('db')).status, 'stopped');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a corrupt host receipt consistently rejects status with an ownership error code
 * 协作入口 / Collaborators: `fixture`, `f.scopes`, `runServices`, `JSON.stringify`.
 * 检查边界 / Checked boundaries: `assert.rejects(scopes.metadata('db'), { code: 'SERVICE_SCOPE_CHANGED' })`; `assert.rejects(scopes.status('db'), { code: 'SERVICE_SCOPE_CHANGED' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a corrupt host receipt consistently rejects status with an ownership error code', async () => {
  const f = fixture(), scopes = f.scopes();
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
  for (const damaged of ['{', JSON.stringify({ version: 1 })]) {
    await writeFile(scopes.receipt('db'), damaged);
    await assert.rejects(scopes.metadata('db'), { code: 'SERVICE_SCOPE_CHANGED' });
    await assert.rejects(scopes.status('db'), { code: 'SERVICE_SCOPE_CHANGED' });
    assert.equal(f.counts().stops, 0);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an incomplete successful status receipt cannot claim an owned service state
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.scopes().status`, `f.scopes`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scopes().status('db'), { code: 'SERVICE_SCOPE_CHANGED' })`; `assert.equal(f.counts().stops, 0)`.
 */
test('an incomplete successful status receipt cannot claim an owned service state', async () => {
  const f = fixture();
  for (const status of ['prepared', 'running', 'exited', 'stopped', 'unconfirmed']) {
    f.machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ code: 0, stdout: JSON.stringify({ status, bootId: f.bootId, record: null }), …`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 0, stdout: JSON.stringify({ status, bootId: f.bootId, record: null }), …`) through a Promise.
     * 验证场景 / Scenario: an incomplete successful status receipt cannot claim an owned service state
     * 协作入口 / Collaborators: `JSON.stringify`.
     */
    async () => ({ code: 0, stdout: JSON.stringify({ status, bootId: f.bootId, record: null }), stderr: '' });
    await assert.rejects(f.scopes().status('db'), { code: 'SERVICE_SCOPE_CHANGED' });
    assert.equal(f.counts().stops, 0);
  }
});
