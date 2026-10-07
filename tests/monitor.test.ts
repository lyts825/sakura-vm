/**
 * 模块职责：回归验证模块，围绕 `monitor` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `monitor`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: monitor snapshots expose bounded instance state and task metadata without secrets or logs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorSnapshot } from '../server/monitor.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: monitor snapshots expose bounded instance state and task metadata without secrets or logs
 * 协作入口 / Collaborators: `monitorSnapshot`, `assert.equal`, `assert.ok`, `JSON.stringify(snapshot).includes`.
 * 检查边界 / Checked boundaries: `assert.equal(snapshot.totalVms, 105)`; `assert.equal(snapshot.totalJobs, 110)`.
 */
test('monitor snapshots expose bounded instance state and task metadata without secrets or logs', async () => {
  const sensitive = 'PRIVATE_VALUE_MUST_NOT_BE_CACHED';
  const machines: any = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`Array.from({ length: 105 }, (_, index) => ({ id: `vm-${index}`, name: `machine-$…`），以 Promise 交付。
     * Result: Return the branch-computed value (`Array.from({ length: 105 }, (_, index) => ({ id: `vm-${index}`, name: `machine-$…`) through a Promise.
     * 验证场景 / Scenario: monitor snapshots expose bounded instance state and task metadata without secrets or logs
     * 协作入口 / Collaborators: `Array.from`.
     */
    list: async () =>
      Array.from({ length: 105 }, (_, index) => ({
        id: `vm-${index}`,
        name: `machine-${index}`,
        status: 'running',
        cpus: 2,
        memoryMiB: 512,
        sshKey: sensitive,
        projects: [sensitive],
      })),
  };
  const stores: any = [
    {
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`Array.from({ length: 110 }, (_, index) => ({ id: `job-${index}`, vmId: 'vm-0', s…`）。
       * Result: Return the branch-computed value (`Array.from({ length: 110 }, (_, index) => ({ id: `job-${index}`, vmId: 'vm-0', s…`).
       * 验证场景 / Scenario: monitor snapshots expose bounded instance state and task metadata without secrets or logs
       * 协作入口 / Collaborators: `Array.from`.
       */
      list: () =>
        Array.from({ length: 110 }, (_, index) => ({
          id: `job-${index}`,
          vmId: 'vm-0',
          scope: 'suite',
          action: index === 109 ? 'cat /private/key' : 'sample',
          title: sensitive,
          status: 'done',
          log: sensitive,
          result: { secret: sensitive },
          execution: { command: sensitive },
          startedAt: new Date(index * 1000).toISOString(),
        })),
    },
  ];
  const snapshot = await monitorSnapshot(machines, stores);
  assert.equal(snapshot.totalVms, 105);
  assert.equal(snapshot.totalJobs, 110);
  assert.equal(snapshot.vms.length, 100);
  assert.equal(snapshot.jobs.length, 100);
  assert.equal(snapshot.jobs[0].id, 'job-109');
  assert.equal(snapshot.jobs[0].action, 'task');
  assert.equal(snapshot.jobs[1].action, 'sample');
  assert.ok(!JSON.stringify(snapshot).includes(sensitive));
  assert.ok(!JSON.stringify(snapshot).includes('/private/key'));
  assert.ok(Math.abs(Date.now() - Date.parse(snapshot.capturedAt)) < 2000);
});
