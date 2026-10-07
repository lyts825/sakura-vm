/**
 * 模块职责：回归验证模块，围绕 `host-disk-health` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `host-disk-health`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: disk reports distinguish explicit zero counters from missing, partial and unmapped evidence; disk reports flag actual capacity, wear, temperature and lifetime errors without inventing current failures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDiskHealth } from '../server/host-disk-health';
import { windowsProbe } from '../server/windows-probe';

const capacity = { totalBytes: 100 * 1024 ** 3, availableBytes: 50 * 1024 ** 3 };
const observation = {
  volume: { health: 'Healthy', operational: ['OK'], filesystem: 'NTFS' },
  disks: [
    {
      number: 1,
      name: 'test NVMe',
      bus: 'NVMe',
      health: 'Healthy',
      operational: ['Online'],
      counters: {
        temperatureC: 35,
        maximumTemperatureC: 80,
        wearPercent: 0,
        powerOnHours: 10,
        readErrorsUncorrected: 0,
        writeErrorsUncorrected: 0,
      },
    },
  ],
};

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: disk reports distinguish explicit zero counters from missing, partial and unmapped evidence
 * 协作入口 / Collaborators: `assert.equal`, `evaluateDiskHealth`, `assert.ok`, `report.findings.some`.
 * 检查边界 / Checked boundaries: `assert.equal(evaluateDiskHealth(observation, capacity, {}).status, 'healthy')`; `assert.equal(report.status, 'unknown')`.
 */
test('disk reports distinguish explicit zero counters from missing, partial and unmapped evidence', () => {
  assert.equal(evaluateDiskHealth(observation, capacity, {}).status, 'healthy');
  for (const change of [
    { ...observation, disks: [] },
    { ...observation, disks: [{ ...observation.disks[0], counters: null, countersError: 'Access denied' }] },
    {
      ...observation,
      disks: [{ ...observation.disks[0], counters: { ...observation.disks[0].counters, wearPercent: null } }],
    },
  ]) {
    const report = evaluateDiskHealth(change, capacity, {});
    assert.equal(report.status, 'unknown');
    assert.ok(report.findings.some((item) => item.severity === 'unknown'));
  }
  assert.throws(() => evaluateDiskHealth(observation, capacity, { arbitrary: true }));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: disk reports flag actual capacity, wear, temperature and lifetime errors without inventing current failures
 * 状态影响 / State effects: `data.disks[0].health`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `structuredClone`, `Object.assign`, `evaluateDiskHealth`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 'warning')`; `assert.equal(result.findings.length, 4)`.
 */
test('disk reports flag actual capacity, wear, temperature and lifetime errors without inventing current failures', () => {
  const data = structuredClone(observation);
  Object.assign(data.disks[0].counters, { temperatureC: 71, wearPercent: 91, readErrorsUncorrected: 5 });
  const result = evaluateDiskHealth(data, { ...capacity, availableBytes: 1024 ** 3 }, {});
  assert.equal(result.status, 'warning');
  assert.equal(result.findings.length, 4);
  assert.match(result.findings.at(-1)!.message, /历史/);
  data.disks[0].health = 'Unhealthy';
  assert.equal(evaluateDiskHealth(data, capacity, {}).status, 'critical');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Windows probe keeps shell syntax in stdin data and aborts a running query
 * 协作入口 / Collaborators: `windowsProbe`, `assert.deepEqual`, `abort.abort`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(result, { value })`; `assert.rejects(request, /cancelled Windows probe/)`.
 */
test(
  'Windows probe keeps shell syntax in stdin data and aborts a running query',
  { skip: process.platform !== 'win32' },
  async () => {
    const value = "中文 '$([Environment]::Exit(9))' `n";
    const result = await windowsProbe('@{value=$request.value} | ConvertTo-Json -Compress', { value });
    assert.deepEqual(result, { value });
    const abort = new AbortController();
    const request = windowsProbe('Start-Sleep -Seconds 10; @{done=$true} | ConvertTo-Json', {}, abort.signal);
    abort.abort(new Error('cancelled Windows probe'));
    await assert.rejects(request, /cancelled Windows probe/);
  },
);
