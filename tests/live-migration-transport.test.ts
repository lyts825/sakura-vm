/**
 * 模块职责：回归验证模块，围绕 `live-migration-transport` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `live-migration-transport`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: migration refuses legacy CPU models and changed topology before changing either VM; matching CPU layouts allow different QOM paths, property order and slot order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateQemuWithMirroredDisk, type MigrationQmp } from '../server/live-migration-transport.ts';

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: model = 'Nehalem-v1'; core = 0。
 * 结果：返回列表形式的受控数据，供调用者遍历或比较。
 * Result: Return controlled data as a list for iteration or comparison.
 */
const cpus = (model = 'Nehalem-v1', core = 0) => [
  {
    type: model + '-x86_64-cpu',
    'vcpus-count': 1,
    props: { 'socket-id': 0, 'core-id': core, 'thread-id': 0 },
    'qom-path': '/machine/unattached/device[0]',
  },
];

/**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: sourceCpus: unknown; targetCpus: unknown; failure: RegExp。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `assert.rejects`, `migrateQemuWithMirroredDisk`, `endpoint`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects( migrateQemuWithMirroredDisk({ source: endpoint(true, sourceCpus), target: endpoint(false, targetCpus), sourceDiskN…`; `assert.deepEqual(changes, [], 'CPU validation must finish before migration or fencing')`.
 */
async function check(sourceCpus: unknown, targetCpus: unknown, failure: RegExp) {
  const changes: string[] = [];
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: running: boolean; slots: unknown。
   * 结果：返回分支计算值（`async (command) => { if (command === 'query-status') return { running, status: r…`）。
   * Result: Return the branch-computed value (`async (command) => { if (command === 'query-status') return { running, status: r…`).
   */
  const endpoint =
    (running: boolean, slots: unknown): MigrationQmp =>
    async (command) => {
      if (command === 'query-status') return { running, status: running ? 'running' : 'paused' };
      if (command === 'query-version') return { qemu: { major: 11, minor: 1, micro: 0 } };
      if (command === 'query-hotpluggable-cpus') return slots;
      if (command === 'query-block') throw new Error('CPU compatibility accepted');
      changes.push(command);
      throw new Error('Unexpected mutation');
    };
  await assert.rejects(
    migrateQemuWithMirroredDisk({
      source: endpoint(true, sourceCpus),
      target: endpoint(false, targetCpus),
      sourceDiskNode: 'source',
      targetDiskNode: 'target',
      nbdListen: { type: 'inet', host: '127.0.0.1', port: '12000' },
      nbdConnect: { type: 'inet', host: '127.0.0.1', port: '12000' },
      incomingUri: 'tcp:127.0.0.1:12001',
      outgoingUri: 'tcp:127.0.0.1:12001',
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `changes.push`.
       */
      fenceSource: async () => {
        changes.push('fence');
      },
    }),
    failure,
  );
  assert.deepEqual(changes, [], 'CPU validation must finish before migration or fencing');
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: migration refuses legacy CPU models and changed topology before changing either VM
 * 协作入口 / Collaborators: `check`, `cpus`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('migration refuses legacy CPU models and changed topology before changing either VM', async () => {
  await check(cpus('qemu64-v1'), cpus(), /CPU models or topology differ/);
  await check(cpus(), cpus('Nehalem-v1', 1), /CPU models or topology differ/);
  await check(cpus(), [], /invalid CPU slots/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: matching CPU layouts allow different QOM paths, property order and slot order
 * 协作入口 / Collaborators: `check`, `cpus`.
 */
test('matching CPU layouts allow different QOM paths, property order and slot order', async () => {
  await check(
    [...cpus(), ...cpus('Nehalem-v1', 1)],
    [
      ...cpus('Nehalem-v1', 1),
      {
        ...cpus()[0],
        props: { 'thread-id': 0, 'core-id': 0, 'socket-id': 0 },
        'qom-path': '/different/target/path',
      },
    ],
    /CPU compatibility accepted/,
  );
});
