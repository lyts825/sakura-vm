/**
 * 模块职责：回归验证模块，围绕 `capability-actions` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `capability-actions`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: large structured job results survive log truncation, restart and detect tampering; PAC rules match exact domain boundaries and reject invalid proxy ports.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const directory = await mkdtemp(join(tmpdir(), 'sakura-capabilities-'));
process.env.SAKURA_DATA_DIR = directory;
const { dependencyOrder, CapabilityActions } = await import('../server/capability-actions.ts');
const { capabilityParameters } = await import('../server/capability-definitions.ts');
const { NextFeatures } = await import('../server/next-features.ts');
const { ExtendedFeatures } = await import('../server/extended-features.ts');
const { taskSlo, metricExport, baselineAnomalies } = await import('../server/capability-reports.ts');
const { Jobs } = await import('../server/jobs.ts');
const { scopeIdentityFixture } = await import('./project-scope-identity-fixture.ts');
const { projectSchema } = await import('../server/workspaces.ts');
const { setVmStorageRoot } = await import('../server/model.ts');
after(() => rm(directory, { recursive: true, force: true }));
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const c = '33333333-3333-4333-8333-333333333333';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: large structured job results survive log truncation, restart and detect tampering
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `'中文内容'.repeat`, `jobs.start`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.log.length, 32768)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('large structured job results survive log truncation, restart and detect tampering', async () => {
  const root = await mkdtemp(join(directory, 'job-results-'));
  const jobs = new Jobs('large-result', root);
  const result = { content: '中文内容'.repeat(40000), last: 'complete' };
  const job = jobs.start('large', async (log, _signal, _update, save) => {
    await save(result);
    log(JSON.stringify(result));
    throw new Error('failed check');
  });
  await jobs.wait('large');
  assert.equal(job.status, 'error');
  assert.equal(job.log.length, 32768);
  assert.deepEqual(await jobs.result(job.id!), result);
  await jobs.close();
  const reloaded = new Jobs('large-result', root);
  assert.deepEqual(await reloaded.result(job.id!), result);
  await writeFile(join(root, 'large-result.json.results', job.id! + '.json'), '{"tampered":true}');
  await assert.rejects(reloaded.result(job.id!), /校验/);
  await reloaded.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: PAC rules match exact domain boundaries and reject invalid proxy ports
 * 协作入口 / Collaborators: `import`, `runReport`, `runInNewContext`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(fn('', 'EXAMPLE.com'), 'PROXY localhost:8080')`; `assert.equal(fn('', 'sub.example.com'), 'PROXY localhost:8080')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('PAC rules match exact domain boundaries and reject invalid proxy ports', async () => {
  const { runReport } = await import('../server/capability-reports.ts');
  const spaces: any = { projects: { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'default'`）。
   * Result: Return the branch-computed value (`'default'`).
   * 验证场景 / Scenario: PAC rules match exact domain boundaries and reject invalid proxy ports
   */
  current: () => 'default' } };
  const report: any = await runReport(
    {} as any,
    spaces,
    a,
    'proxy-pac',
    {
      rules: [{ domain: 'example.com', subdomains: true, proxy: 'PROXY localhost:8080' }],
    },
    new AbortController().signal,
  );
  const context = {};
  const fn = runInNewContext(report.download.content + '\nFindProxyForURL', context);
  assert.equal(fn('', 'EXAMPLE.com'), 'PROXY localhost:8080');
  assert.equal(fn('', 'sub.example.com'), 'PROXY localhost:8080');
  assert.equal(fn('', 'evilexample.com'), 'DIRECT');
  await assert.rejects(
    runReport(
      {} as any,
      spaces,
      a,
      'proxy-pac',
      {
        rules: [{ domain: 'example.com', subdomains: true, proxy: 'PROXY localhost:99999' }],
      },
      new AbortController().signal,
    ),
    /端口/,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: dependency startup validates cycles and waits in topological order
 * 协作入口 / Collaborators: `assert.deepEqual`, `dependencyOrder`, `assert.throws`, `actions.run`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(dependencyOrder(a, { [a]: [b, c], [b]: [c] }), [c, b, a])`; `assert.throws(() => dependencyOrder(a, { [a]: [b], [b]: [a] }), /循环/)`.
 */
test('dependency startup validates cycles and waits in topological order', async () => {
  assert.deepEqual(dependencyOrder(a, { [a]: [b, c], [b]: [c] }), [c, b, a]);
  assert.throws(() => dependencyOrder(a, { [a]: [b], [b]: [a] }), /循环/);
  const states = new Map<string, string>(),
    started: string[] = [];
  const machines: any = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`({ id, name: id })`）。
     * Result: Return the branch-computed value (`({ id, name: id })`).
     * 验证场景 / Scenario: dependency startup validates cycles and waits in topological order
     */
    get: (id: string) => ({ id, name: id }),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: dependency startup validates cycles and waits in topological order
     */
    requireUnlocked() {},
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`states.get(id) || 'stopped'`）。
     * Result: Return the branch-computed value (`states.get(id) || 'stopped'`).
     * 验证场景 / Scenario: dependency startup validates cycles and waits in topological order
     * 协作入口 / Collaborators: `states.get`.
     */
    state: (id: string) => states.get(id) || 'stopped',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: id: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: dependency startup validates cycles and waits in topological order
     * 协作入口 / Collaborators: `started.push`, `states.set`.
     */
    async start(id: string) {
      started.push(id);
      states.set(id, 'running');
    },
  };
  const actions = new CapabilityActions(machines, {} as any);
  const result = await actions.run(
    a,
    'vm-dependency-start',
    { dependencies: { [a]: [b], [b]: [c] } },
    new AbortController().signal,
  );
  assert.equal(result.ready, true);
  assert.deepEqual(started, [c, b, a]);
  await assert.rejects(
    actions.run(
      a,
      'vm-dependency-start',
      { dependencies: { [a]: [b], [b]: [a] } },
      new AbortController().signal,
    ),
  );
  assert.equal(started.length, 3);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: capability parameters reject traversal and unknown fields
 * 协作入口 / Collaborators: `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.throws(() => capabilityParameters('directory-history', { mode: 'snapshot', path: '../outside' }))`; `assert.throws(() => capabilityParameters('test-sharding', { files: ['a'], shards: 0 }))`.
 */
test('capability parameters reject traversal and unknown fields', () => {
  assert.throws(() => capabilityParameters('directory-history', { mode: 'snapshot', path: '../outside' }));
  assert.throws(() => capabilityParameters('test-sharding', { files: ['a'], shards: 0 }));
  assert.throws(() => capabilityParameters('test-matrix', { targets: [], argv: ['echo'] }));
  assert.throws(() => capabilityParameters('network-topology', { arbitrary: true }));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: task SLO treats missing samples and interruptions truthfully
 * 协作入口 / Collaborators: `assert.equal`, `taskSlo`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal(taskSlo([], 99).actualPercent, null)`; `assert.equal(result.samples, 3)`.
 */
test('task SLO treats missing samples and interruptions truthfully', () => {
  assert.equal(taskSlo([], 99).actualPercent, null);
  const result = taskSlo(
    [{ status: 'done' }, { status: 'error' }, { status: 'interrupted' }, { status: 'running' }] as any,
    90,
  );
  assert.equal(result.samples, 3);
  assert.equal(result.failed, 2);
  assert.equal(result.achieved, false);
  assert.ok(result.remainingFailures < 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: metrics formats escape labels and retain nanosecond timestamps without precision loss
 * 协作入口 / Collaborators: `metricExport`, `assert.ok`, `text.includes`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.ok(text.includes('vm_name="quoted\\"\\nname"'))`; `assert.equal(gauge.dataPoints[0].timeUnixNano, (BigInt(Date.parse(point.sampledAt)) * 1000000n).toString())`.
 */
test('metrics formats escape labels and retain nanosecond timestamps without precision loss', () => {
  const point = {
    sampledAt: '2026-09-26T00:00:00.123Z',
    cpuPercent: 25,
    memoryUsed: 10,
    memoryTotal: 20,
    diskUsed: 30,
    diskTotal: 40,
  };
  const text = metricExport(a, 'quoted"\nname', point, 'prometheus').content;
  assert.ok(text.includes('vm_name="quoted\\"\\nname"'));
  const json = JSON.parse(metricExport(a, 'test', point, 'otlp-json').content);
  const gauge = json.resourceMetrics[0].scopeMetrics[0].metrics[0].gauge;
  assert.equal(gauge.dataPoints[0].timeUnixNano, (BigInt(Date.parse(point.sampledAt)) * 1000000n).toString());
  assert.equal(gauge.dataPoints[0].asDouble, 25);
  assert.throws(() => metricExport(a, 'test', { ...point, cpuPercent: NaN }, 'prometheus'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: anomaly detection excludes the latest point from its baseline
 * 协作入口 / Collaborators: `Array.from`, `baselineAnomalies`, `assert.deepEqual`, `result.anomalies.map`.
 * 检查边界 / Checked boundaries: `assert.deepEqual( result.anomalies.map((item) => item.field), ['cpuPercent'], )`; `assert.throws(() => baselineAnomalies(rows.slice(0, 3), 30, 3), /至少/)`.
 */
test('anomaly detection excludes the latest point from its baseline', () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({
    sampledAt: new Date(index * 1000).toISOString(),
    cpuPercent: index === 6 ? 90 : 2,
    memoryUsed: 100,
    memoryTotal: 1000,
    diskUsed: 200,
    diskTotal: 2000,
  }));
  const result = baselineAnomalies(rows, 30, 3);
  assert.deepEqual(
    result.anomalies.map((item) => item.field),
    ['cpuPercent'],
  );
  assert.throws(() => baselineAnomalies(rows.slice(0, 3), 30, 3), /至少/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: capability worker exercises actual files and subprocesses
 * 协作入口 / Collaborators: `spawnSync`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr)`.
 */
test('capability worker exercises actual files and subprocesses', { timeout: 90000 }, () => {
  const python = process.env.SAKURA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, ['tests/capability_runner_test.py'], {
    encoding: 'utf8',
    timeout: 80000,
    env: { ...process.env, PYTHONUTF8: '1' },
  });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `machines, workspaces, fail, calls`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, workspaces, fail, calls`; the actual branch determines its shape.
 * 状态影响 / State effects: `machines.execInput`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `projectSchema.parse`, `randomUUID`, `join`, `setVmStorageRoot`.
 */
function fixture() {
  let result = { code: 0, shards: [] },
    calls = 0;
  const context = new AsyncLocalStorage<{ vmId: string; projectId: string }>();
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: id: string。
   * 结果：返回分支计算值（`context.getStore()?.vmId === id ? context.getStore()!.projectId : 'default'`）。
   * Result: Return the branch-computed value (`context.getStore()?.vmId === id ? context.getStore()!.projectId : 'default'`).
   * 协作入口 / Collaborators: `context.getStore`.
   */
  const current = (id: string) => context.getStore()?.vmId === id ? context.getStore()!.projectId : 'default';
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: id: string; projectId: string; action: () => T。
   * 结果：返回分支计算值（`context.run({ vmId: id, projectId }, action)`）。
   * Result: Return the branch-computed value (`context.run({ vmId: id, projectId }, action)`).
   * 协作入口 / Collaborators: `context.run`.
   */
  const inScope = <T>(id: string, projectId: string, action: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => T) =>
    context.run({ vmId: id, projectId }, action);
  const project = projectSchema.parse({ directory: '/workspace', template: 'none', environment: {} });
  const bootId = randomUUID(), fixtureRoot = join(directory, 'identity-fixture-' + randomUUID());
  for (const id of [a, b, c]) setVmStorageRoot(id, join(fixtureRoot, id));
  const machines: any = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    on() {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    off() {},
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`({ id, forwards: [], distro: 'alpine' })`）。
     * Result: Return the branch-computed value (`({ id, forwards: [], distro: 'alpine' })`).
     */
    get: (id: string) => ({ id, forwards: [], distro: 'alpine' }),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    requireUnlocked() {},
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     */
    state: () => 'running',
    live: new Map([a, b, c].map(id => [id, { status: 'running' }])),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _: string; action: () => Promise<unknown>。
     * 结果：返回分支计算值（`action()`），以 Promise 交付。
     * Result: Return the branch-computed value (`action()`) through a Promise.
     * 协作入口 / Collaborators: `action`.
     */
    locked: async (_: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => action(),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `assert.fail`.
     * 检查边界 / Checked boundaries: `assert.fail('Engineering tasks must not publish a root helper file')`.
     */
    writeGuestFile: async () => { assert.fail('Engineering tasks must not publish a root helper file'); },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.ok`, `command.startsWith`.
     * 检查边界 / Checked boundaries: `assert.ok(!command.startsWith('# SAKURA_GUEST_TASK_RUN'), 'Project code must use the protected stdin frame')`.
     */
    exec: async (_id: string, command: string) => {
      assert.ok(!command.startsWith('# SAKURA_GUEST_TASK_RUN'), 'Project code must use the protected stdin frame');
      // Scope fixture handles boot/latch/absence probes. Directory preparation
      // and guest-task cleanup/confirmation/retirement are administrative controls.
      return { stdout: '', stderr: '', code: 0 };
    },
  };
  const workspaces: any = {
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`() => {}`）。
     * Result: Return the branch-computed value (`() => {}`).
     */
    beforeConfigChange: () => () => {},
    projects: {
      current,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: id: string。
       * 结果：返回分支计算值（`id`）。
       * Result: Return the branch-computed value (`id`).
       */
      key: (id: string) => id,
      inScope,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: id: string; projectId: string | null | undefined; action: () => T。
       * 结果：返回分支计算值（`inScope(id, projectId || current(id), action)`）。
       * Result: Return the branch-computed value (`inScope(id, projectId || current(id), action)`).
       * 协作入口 / Collaborators: `inScope`, `current`.
       */
      with: <T>(id: string, projectId: string | null | undefined, action: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      () => T) =>
        inScope(id, projectId || current(id), action),
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`Object.defineProperty(structuredClone(project), '_workspace', { value: current(i…`），以 Promise 交付。
     * Result: Return the branch-computed value (`Object.defineProperty(structuredClone(project), '_workspace', { value: current(i…`) through a Promise.
     * 协作入口 / Collaborators: `Object.defineProperty`, `structuredClone`, `current`.
     */
    config: async (id: string) => Object.defineProperty(structuredClone(project), '_workspace', { value: current(id) }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; captured: typeof project。
     * 结果：返回分支计算值（`captured`），以 Promise 交付。
     * Result: Return the branch-computed value (`captured`) through a Promise.
     */
    resolveProject: async (_id: string, captured: typeof project) => captured,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`workspaces.config(id)`），以 Promise 交付。
     * Result: Return the branch-computed value (`workspaces.config(id)`) through a Promise.
     * 协作入口 / Collaborators: `workspaces.config`.
     */
    resolvedConfig: async (id: string) => workspaces.config(id),
  };
  scopeIdentityFixture(machines, project, () => bootId, () => null);
  const executeFrame = machines.execInput.bind(machines);
  machines.execInput = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args: Parameters<typeof machines.execInput>。
   * 结果：返回受控对象，公开字段包括 `stdout, code`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `stdout, code`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `assert.ok`, `String(args[1]).startsWith`, `String`, `executeFrame`.
   * 检查边界 / Checked boundaries: `assert.ok(String(args[1]).startsWith('# SAKURA_GUEST_TASK_RUN'))`.
   */
  async (...args: Parameters<typeof machines.execInput>) => {
    assert.ok(String(args[1]).startsWith('# SAKURA_GUEST_TASK_RUN'));
    // Preserve real host issuance, exact run UUID, native frame checks and
    // cleanup receipts; only this finite UID worker's JSON response is simulated.
    const execution = await executeFrame(...args);
    ++calls;
    return { ...execution, stdout: JSON.stringify(result), code: result.code };
  };
  return {
    machines,
    workspaces,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `result`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    fail: () => {
      result = { code: 8, shards: [] };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`calls`）。
     * Result: Return the branch-computed value (`calls`).
     */
    calls: () => calls,
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: platform action executes sharding, logs failures, and validates before queueing
 * 协作入口 / Collaborators: `fixture`, `service.view`, `assert.ok`, `view.capabilities.some`.
 * 检查边界 / Checked boundaries: `assert.ok(view.capabilities.some((item) => item.id === 'test-sharding'))`; `assert.rejects( service.action(a, { action: 'run', featureId: 'test-sharding', options: { files: [] } }), )`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('platform action executes sharding, logs failures, and validates before queueing', async () => {
  const f = fixture(),
    service = new NextFeatures(f.machines, f.workspaces);
  try {
    const view = await service.view(a);
    assert.ok(view.capabilities.some((item) => item.id === 'test-sharding'));
    await assert.rejects(
      service.action(a, { action: 'run', featureId: 'test-sharding', options: { files: [] } }),
    );
    assert.equal(f.calls(), 0);
    const job: any = await service.action(a, {
      action: 'run',
      featureId: 'test-sharding',
      options: { files: ['a'], mode: 'plan' },
    });
    await service.jobs.wait(job.key);
    assert.equal(service.jobs.view(job.key)?.status, 'done');
    f.fail();
    const failed: any = await service.action(a, {
      action: 'run',
      featureId: 'test-sharding',
      options: { files: ['a'], mode: 'plan' },
    });
    await service.jobs.wait(failed.key);
    assert.equal(service.jobs.view(failed.key)?.status, 'error');
    assert.match(service.jobs.view(failed.key)?.log || '', /"code":8/);
  } finally {
    await service.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cross-instance test matrix preserves each failure in the job result
 * 协作入口 / Collaborators: `fixture`, `f.fail`, `service.action`, `service.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(service.jobs.view(job.key)?.status, 'error')`; `assert.equal(result.results.length, 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('cross-instance test matrix preserves each failure in the job result', async () => {
  const f = fixture(),
    service = new ExtendedFeatures(f.machines, f.workspaces);
  f.fail();
  try {
    const job: any = await service.action(a, {
      action: 'run',
      featureId: 'test-matrix',
      options: {
        targets: [{ vmId: a }, { vmId: b }],
        argv: ['python3', '-m', 'unittest'],
      },
    });
    await service.jobs.wait(job.key);
    assert.equal(service.jobs.view(job.key)?.status, 'error');
    const result = JSON.parse(service.jobs.view(job.key)!.log);
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every((item: any) => item.code === 8));
  } finally {
    await service.close();
  }
});
