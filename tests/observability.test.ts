/**
 * 模块职责：回归验证模块，围绕 `observability` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `observability`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: network metrics exclude loopback, calculate observed rates and leave resets or gaps unknown; rotation notices persist once per stage, survive plugin absence and refresh only for a new value.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'sakura-observability-'));
process.env.SAKURA_DATA_DIR = root;
const { parseMetrics, networkRates } = await import('../server/metrics.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { saveMaintenancePolicy } = await import('../server/automation-policy.ts');
const { CapabilityActions } = await import('../server/capability-actions.ts');
const { secretRotation } = await import('../server/secret-rotation.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-observability-'));
  await rm(root, { recursive: true, force: true });
});
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: uptime = 30; rx = 1000; tx = 2000。
 * 结果：返回分支计算值（`parseMetrics( `CPU\ncpu 10 0 10 100 0 0 0 0\ncpu 30 0 20 150 20 0 0 0\nMEMORY\nM…`）。
 * Result: Return the branch-computed value (`parseMetrics( `CPU\ncpu 10 0 10 100 0 0 0 0\ncpu 30 0 20 150 20 0 0 0\nMEMORY\nM…`).
 * 协作入口 / Collaborators: `parseMetrics`.
 */
const sample = (uptime = 30, rx = 1000, tx = 2000) =>
  parseMetrics(
    `CPU\ncpu 10 0 10 100 0 0 0 0\ncpu 30 0 20 150 20 0 0 0\nMEMORY\nMemTotal: 1024 kB\nMemAvailable: 512 kB\nDISK\n/dev/vda1 1000 400 600 40% /\nNETWORK\n lo: 9999 0 0 0 0 0 0 0 9999 0 0 0 0 0 0 0\n eth0: ${rx} 0 0 0 0 0 0 0 ${tx} 0 0 0 0 0 0 0\nPROCESSES\n123 python3\nUPTIME\n${uptime} 10.0\n`,
  );

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network metrics exclude loopback, calculate observed rates and leave resets or gaps unknown
 * 状态影响 / State effects: `changed.networkInterfaces[0].name`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `sample`, `assert.equal`, `networkRates`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.equal(previous.networkReceivedBytes, 1000)`; `assert.equal(previous.networkTransmitBytesPerSecond, null)`.
 */
test('network metrics exclude loopback, calculate observed rates and leave resets or gaps unknown', () => {
  const previous = sample();
  assert.equal(previous.networkReceivedBytes, 1000);
  assert.equal(previous.networkTransmitBytesPerSecond, null);
  const current = networkRates(sample(40, 2000, 5000), previous);
  assert.equal(current.networkReceiveBytesPerSecond, 100);
  assert.equal(current.networkTransmitBytesPerSecond, 300);
  for (const point of [sample(2), sample(200), sample(40, 1), sample(40, 2000, 1)])
    assert.equal(networkRates(point, previous).networkReceiveBytesPerSecond, null);
  const changed = sample(40, 2000, 5000);
  changed.networkInterfaces[0].name = 'eth1';
  assert.equal(networkRates(changed, previous).networkReceiveBytesPerSecond, null);
  assert.throws(() => sample(40, -1), /网络采样/);
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `id, secondId, machines, workspaces, setPoint, stop`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, secondId, machines, workspaces, setPoint, stop`; the actual branch determines its shape.
 * 状态影响 / State effects: `machines.state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `sample`.
 */
function fixture() {
  const id = randomUUID(),
    secondId = randomUUID();
  const vm: any = { id, cpus: 1, memoryMiB: 512 },
    second: any = { ...vm, id: secondId };
  const machines: any = {
    records: new Map([
      [id, vm],
      [secondId, second],
    ]),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     */
    state: () => 'running',
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: key: string。
     * 结果：返回分支计算值（`(key === id ? vm : second)`）。
     * Result: Return the branch-computed value (`(key === id ? vm : second)`).
     */
    get: (key: string) => (key === id ? vm : second),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    requireUnlocked: () => {},
  };
  let point = sample(),
    status = 'running';
  machines.state = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`status`）。
   * Result: Return the branch-computed value (`status`).
   */
  () => status;
  const workspaces: any = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`point`），以 Promise 交付。
     * Result: Return the branch-computed value (`point`) through a Promise.
     */
    metrics: async () => point,
    projects: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'default'`）。
     * Result: Return the branch-computed value (`'default'`).
     */
    current: () => 'default', /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: key: string。
     * 结果：返回分支计算值（`key`）。
     * Result: Return the branch-computed value (`key`).
     */
    key: (key: string) => key },
  };
  return {
    id,
    secondId,
    machines,
    workspaces,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: typeof point。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `point`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setPoint: (value: typeof point) => {
      point = value;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    stop: () => {
      status = 'stopped';
    },
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: rotation notices persist once per stage, survive plugin absence and refresh only for a new value
 * 状态影响 / State effects: `suite`, `available`, `now`, `changed`, `events`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `Date.now`, `suite.enableBackground`, `suite.update`.
 * 检查边界 / Checked boundaries: `assert.equal(events.length, 1)`; `assert.equal(events[0].kind, 'secret')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('rotation notices persist once per stage, survive plugin absence and refresh only for a new value', async () => {
  const f = fixture(),
    policy = { enabled: true, maxAgeDays: 30, remindBeforeDays: 7 },
    day = 86400000;
  let changed = Date.now() - 25 * day,
    now = Date.now(),
    available = true;
  const observations = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`available ? id === f.id ? [secretRotation('api-token', new Date(changed).toISOSt…`），以 Promise 交付。
     * Result: Return the branch-computed value (`available ? id === f.id ? [secretRotation('api-token', new Date(changed).toISOSt…`) through a Promise.
     * 验证场景 / Scenario: rotation notices persist once per stage, survive plugin absence and refresh only for a new value
     * 协作入口 / Collaborators: `secretRotation`, `new Date(changed).toISOString`.
     */
    secrets: async (id: string) =>
      available
        ? id === f.id
          ? [secretRotation('api-token', new Date(changed).toISOString(), policy, now)]
          : []
        : undefined,
  };
  let suite = new FeatureSuite(f.machines, f.workspaces, observations);
  suite.enableBackground();
  await suite.update(f.id, { alerts: { enabled: true } });
  try {
    await suite.tick();
    let events = (await suite.view(f.id)).events;
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'secret');
    await suite.acknowledge(f.id, events[0].id);
    await suite.close();
    suite = new FeatureSuite(f.machines, f.workspaces, observations);
    suite.enableBackground();
    available = false;
    await suite.tick();
    available = true;
    await suite.tick();
    assert.equal((await suite.view(f.id)).events.length, 1);
    now += 7 * day;
    await suite.tick();
    assert.equal((await suite.view(f.id)).events.length, 2);
    changed = now;
    await suite.tick();
    assert.equal((await suite.view(f.id)).events.length, 2);
    now += 25 * day;
    await suite.tick();
    events = (await suite.view(f.id)).events;
    assert.equal(events.length, 3);
    assert.equal(events.filter((event) => event.acknowledged).length, 1);
    assert.equal((await suite.view(f.secondId)).events.length, 0);
    await suite.update(f.id, { alerts: { enabled: true, secretRotation: false } });
    now += 7 * day;
    await suite.tick();
    assert.equal((await suite.view(f.id)).events.length, 3);
  } finally {
    await suite.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: concurrent first samples persist both VMs, cached samples are unique and network history survives restart
 * 协作入口 / Collaborators: `fixture`, `networkRates`, `sample`, `f.setPoint`.
 * 检查边界 / Checked boundaries: `assert.equal((await suite.view(f.id)).history.length, 1)`; `assert.equal((await restarted.view(f.id)).history[0].networkReceiveBytesPerSecond, 100)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('concurrent first samples persist both VMs, cached samples are unique and network history survives restart', async () => {
  const f = fixture(),
    suite = new FeatureSuite(f.machines, f.workspaces);
  const point = networkRates(sample(40, 2000, 5000), sample());
  f.setPoint(point);
  await Promise.all([suite.sample(f.id), suite.sample(f.secondId), suite.sample(f.id)]);
  assert.equal((await suite.view(f.id)).history.length, 1);
  await suite.close();
  const restarted = new FeatureSuite(f.machines, f.workspaces);
  try {
    assert.equal((await restarted.view(f.id)).history[0].networkReceiveBytesPerSecond, 100);
    assert.equal((await restarted.view(f.secondId)).history.length, 1);
    const persisted = JSON.parse(await readFile(join(root, 'feature-suite.json'), 'utf8'));
    assert.equal(persisted.history[f.secondId][0].networkTransmitBytesPerSecond, 300);
  } finally {
    await restarted.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: real task failures and unhealthy desired services create durable alerts once, while stopped services and old tasks stay quiet
 * 状态影响 / State effects: `jobs`, `services`, `suite`, `events`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `suite.enableBackground`, `suite.update`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.equal(events.length, 2)`; `assert.ok(events.some((entry) => entry.kind === 'backup' && entry.jobId === backup.id))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('real task failures and unhealthy desired services create durable alerts once, while stopped services and old tasks stay quiet', async () => {
  const f = fixture();
  let jobs: any[] = [],
    services: any[] = [];
  const observations = { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`jobs`）。
   * Result: Return the branch-computed value (`jobs`).
   * 验证场景 / Scenario: real task failures and unhealthy desired services create durable alerts once, while stopped services and old tasks stay quiet
   */
  jobs: () => jobs, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: id: string。
   * 结果：返回分支计算值（`(id === f.id ? services : [])`）。
   * Result: Return the branch-computed value (`(id === f.id ? services : [])`).
   * 验证场景 / Scenario: real task failures and unhealthy desired services create durable alerts once, while stopped services and old tasks stay quiet
   */
  services: (id: string) => (id === f.id ? services : []) };
  let suite = new FeatureSuite(f.machines, f.workspaces, observations);
  suite.enableBackground();
  await suite.update(f.id, { alerts: { enabled: true } });
  const backup = {
    id: randomUUID(),
    vmId: f.id,
    scope: 'backups',
    status: 'error',
    title: '创建备份',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    error: 'password=must-not-be-notified',
  };
  jobs = [backup, { ...backup, id: randomUUID(), finishedAt: new Date(0).toISOString() }];
  services = [
    {
      name: 'web',
      desired: true,
      status: 'exhausted',
      projectId: 'project-one',
      checkedAt: new Date().toISOString(),
    },
    {
      name: 'stopped',
      desired: false,
      status: 'unhealthy',
      projectId: 'default',
      checkedAt: new Date().toISOString(),
    },
  ];
  // Monitoring continues in an automation maintenance window, without starting or stopping the guest.
  await saveMaintenancePolicy(f.id, {
    enabled: true,
    windows: [{ days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'UTC', start: '00:00', end: '00:00' }],
  });
  try {
    await suite.tick();
    let events = (await suite.view(f.id)).events;
    assert.equal(events.length, 2);
    assert.ok(events.some((entry) => entry.kind === 'backup' && entry.jobId === backup.id));
    assert.ok(events.some((entry) => entry.kind === 'service' && entry.projectId === 'project-one'));
    assert.ok(!JSON.stringify(events).includes('must-not-be-notified'));
    await suite.acknowledge(f.id, events[0].id);
    await suite.tick();
    assert.equal((await suite.view(f.id)).events.length, 2);
    await suite.close();
    suite = new FeatureSuite(f.machines, f.workspaces, observations);
    suite.enableBackground();
    f.stop();
    await suite.tick();
    events = (await suite.view(f.id)).events;
    assert.equal(events.length, 2);
    assert.equal(events.filter((event) => event.acknowledged).length, 1);
    jobs = [];
    await suite.tick();
    jobs = [backup];
    await suite.tick();
    assert.equal((await suite.view(f.id)).events.length, 2);
    assert.equal((await suite.view(f.secondId)).events.length, 0);
  } finally {
    await suite.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: resource thresholds respect cooldown and disabled operational categories do not create events
 * 协作入口 / Collaborators: `fixture`, `suite.enableBackground`, `suite.update`, `suite.tick`.
 * 检查边界 / Checked boundaries: `assert.deepEqual( events.map((entry) => entry.kind), ['cpu'], )`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('resource thresholds respect cooldown and disabled operational categories do not create events', async () => {
  const f = fixture();
  const suite = new FeatureSuite(f.machines, f.workspaces, {
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回列表形式的受控数据，供调用者遍历或比较。
     * Result: Return controlled data as a list for iteration or comparison.
     * 验证场景 / Scenario: resource thresholds respect cooldown and disabled operational categories do not create events
     * 协作入口 / Collaborators: `randomUUID`, `new Date().toISOString`.
     */
    jobs: () => [
      {
        id: randomUUID(),
        vmId: f.id,
        status: 'error',
        scope: 'backups',
        log: '',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    ],
  });
  suite.enableBackground();
  try {
    await suite.update(f.id, {
      alerts: { enabled: true, cpuPercent: 10, taskFailures: false, serviceFailures: false },
    });
    await suite.tick();
    f.setPoint({ ...sample(), sampledAt: new Date(Date.now() + 1).toISOString() });
    await suite.tick();
    const events = (await suite.view(f.id)).events;
    assert.deepEqual(
      events.map((entry) => entry.kind),
      ['cpu'],
    );
  } finally {
    await suite.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the scheduler records successful probes, failed probes and stopped time for an exportable availability report
 * 状态影响 / State effects: `f.machines.state`, `f.workspaces.metrics`, `now`, `failed`, `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `Date.UTC`, `t.mock.method`, `suite.enableBackground`.
 * 检查边界 / Checked boundaries: `assert.equal(result.code, 0)`; `assert.equal(result.availablePercent, 40)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('the scheduler records successful probes, failed probes and stopped time for an exportable availability report', async (t) => {
  const f = fixture(),
    suite = new FeatureSuite(f.machines, f.workspaces);
  let now = Date.UTC(2026, 0, 1),
    status = 'running',
    failed = false;
  t.mock.method(Date, 'now', () => now);
  f.machines.state = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`status`）。
   * Result: Return the branch-computed value (`status`).
   * 验证场景 / Scenario: the scheduler records successful probes, failed probes and stopped time for an exportable availability report
   */
  () => status;
  f.workspaces.metrics = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `sampledAt`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `sampledAt`; the actual branch determines its shape.
   * 验证场景 / Scenario: the scheduler records successful probes, failed probes and stopped time for an exportable availability report
   * 失败 / Failure: `new Error('SSH unavailable')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `sample`, `new Date(now).toISOString`.
   */
  async () => {
    if (failed) throw new Error('SSH unavailable');
    return { ...sample(), sampledAt: new Date(now).toISOString() };
  };
  suite.enableBackground();
  try {
    await suite.tick();
    now += 30000;
    await suite.tick();
    now += 30000;
    failed = true;
    await suite.tick();
    now += 30000;
    await suite.tick();
    now += 30000;
    status = 'stopped';
    await suite.tick();
    now += 30000;
    await suite.tick();
    const result = (await new CapabilityActions(f.machines, f.workspaces).run(
      f.id,
      'availability-report',
      { hours: 1 },
      new AbortController().signal,
    )) as any;
    assert.equal(result.code, 0);
    assert.equal(result.availablePercent, 40);
    assert.equal(result.durationsSeconds.running, 60);
    assert.equal(result.durationsSeconds.unreachable, 60);
    assert.equal(result.durationsSeconds.stopped, 30);
    assert.equal(JSON.parse(result.download.content).lastStatus, 'stopped');
  } finally {
    await suite.close();
  }
});
