/**
 * 模块职责：回归验证模块，围绕 `memory-reclaim` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `memory-reclaim`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: memory pressure parser rejects incomplete data and decision has hysteresis; persisted policy shrinks only after three samples and restores on guest pressure.
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Machines } from '../server/machines.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-memory-reclaim-test-'));
process.env.SAKURA_DATA_DIR = root;
const { MemoryReclaim, parseGuestMemory, reclaimDecision } =
  await import('../server/memory-reclaim.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-memory-reclaim-test-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: memory pressure parser rejects incomplete data and decision has hysteresis
 * 协作入口 / Collaborators: `assert.deepEqual`, `parseGuestMemory`, `assert.throws`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(parseGuestMemory('MemTotal: 1048576 kB\nMemAvailable: 819200 kB\n'), { totalMiB: 1024, availableMiB: 800 })`; `assert.throws(() => parseGuestMemory('MemTotal: 1048576 kB\n'), /无效/)`.
 */
test('memory pressure parser rejects incomplete data and decision has hysteresis', () => {
  assert.deepEqual(parseGuestMemory('MemTotal: 1048576 kB\nMemAvailable: 819200 kB\n'),
    { totalMiB: 1024, availableMiB: 800 });
  assert.throws(() => parseGuestMemory('MemTotal: 1048576 kB\n'), /无效/);
  assert.equal(reclaimDecision(1024, 1024, 512,
    { totalMiB: 1024, availableMiB: 800 }, 2).decision, 'hold');
  assert.deepEqual(reclaimDecision(1024, 1024, 512,
    { totalMiB: 1024, availableMiB: 800 }, 3),
    { targetMiB: 960, decision: 'shrink', reason: '客户机连续三次可用内存超过 55%，回收至多 64 MiB' });
  assert.equal(reclaimDecision(896, 1024, 512,
    { totalMiB: 896, availableMiB: 100 }, 0).targetMiB, 1024);
  assert.equal(reclaimDecision(384, 1024, 512,
    { totalMiB: 384, availableMiB: 250 }, 3).targetMiB, 512);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: persisted policy shrinks only after three samples and restores on guest pressure
 * 状态影响 / State effects: `memory`, `time`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `first.init`, `first.action`, `first.sample`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(calls, [])`; `assert.deepEqual(calls, [960])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('persisted policy shrinks only after three samples and restores on guest pressure', async () => {
  const id = randomUUID();
  let current = 1024, time = 100_000;
  const calls: number[] = [];
  let memory = { totalMiB: 1024, availableMiB: 800 };
  const vm = { id, distro: 'alpine', memoryMiB: 1024, hardware: undefined };
  const machines = {
    records: new Map([[id, vm]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`vm`）。
     * Result: Return the branch-computed value (`vm`).
     * 验证场景 / Scenario: persisted policy shrinks only after three samples and restores on guest pressure
     */
    get: () => vm,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ...vm, memoryTargetMiB: current })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ...vm, memoryTargetMiB: current })`) through a Promise.
     * 验证场景 / Scenario: persisted policy shrinks only after three samples and restores on guest pressure
     */
    view: async () => ({ ...vm, memoryTargetMiB: current }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: persisted policy shrinks only after three samples and restores on guest pressure
     */
    state: () => 'running',
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: persisted policy shrinks only after three samples and restores on guest pressure
     */
    requireUnlocked: () => {},
    live: new Map([[id, { memoryTargetMiB: current }]]),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _id: string; value: number。
     * 结果：返回受控对象，公开字段包括 `memoryTargetMiB`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `memoryTargetMiB`; the actual branch determines its shape.
     * 验证场景 / Scenario: persisted policy shrinks only after three samples and restores on guest pressure
     * 状态影响 / State effects: `current`, `(machines.live.get(id) as { memoryTargetMiB: number }).memoryTargetMiB`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `machines.live.get`, `calls.push`.
     */
    setMemoryTarget: async (_id: string, value: number) => {
      current = value;
      (machines.live.get(id) as { memoryTargetMiB: number }).memoryTargetMiB = value;
      calls.push(value);
      return { ...vm, memoryTargetMiB: value };
    },
  } as unknown as Machines;
  const first = new MemoryReclaim(machines, async () => memory, () => false, () => {}, () => time);
  await first.init();
  await first.action(id, { operation: 'configure', policy: { enabled: true, minMiB: 512 } });
  await first.sample(id);
  await first.sample(id);
  assert.deepEqual(calls, []);
  await first.sample(id);
  assert.deepEqual(calls, [960]);
  await first.close();

  const second = new MemoryReclaim(machines, async () => memory, () => false, () => {}, () => time);
  await second.init();
  assert.equal((await second.view(id)).policy.enabled, true);
  memory = { totalMiB: 960, availableMiB: 100 };
  time += 61_000;
  await second.sample(id);
  assert.deepEqual(calls, [960, 1024]);
  await second.close();
});
