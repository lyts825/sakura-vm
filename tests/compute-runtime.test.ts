/**
 * 模块职责：回归验证模块，围绕 `compute-runtime` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `compute-runtime`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: worker result is returned only after physical retirement and all dimensions are released; queued cancellation never reads input, and close joins active workers before returning.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Worker } from 'node:worker_threads';
import { gzipSync } from 'node:zlib';
import { ComputeRuntime } from '../server/compute-runtime.ts';
import { HostRuntime, hostRuntime } from '../server/host-runtime/index.ts';
import { previewInWorker } from '../server/file-preview-runtime.ts';
import { previewFile } from '../server/file-preview.ts';

const options = { owner: 'test:compute', label: 'test', memoryBytes: 1 };
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: source = "require('node:worker_threads').parentPort.po…。
 * 结果：返回分支计算值（`({ source, options: { eval: true } })`）。
 * Result: Return the branch-computed value (`({ source, options: { eval: true } })`).
 */
const result = (source = "require('node:worker_threads').parentPort.postMessage({ok:true,result:42});while(true){}") =>
  ({ source, options: { eval: true } });
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`new HostRuntime({ budgets: { 'compute.worker': { capacity: 1 }, 'compute.memory'…`）。
 * Result: Return the branch-computed value (`new HostRuntime({ budgets: { 'compute.worker': { capacity: 1 }, 'compute.memory'…`).
 */
const registry = () => new HostRuntime({ budgets: { 'compute.worker': { capacity: 1 }, 'compute.memory': { capacity: 2 } } });
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: check: () => boolean。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `Date.now`, `check`, `assert.ok`, `delay`.
 * 检查边界 / Checked boundaries: `assert.ok(Date.now() < deadline)`.
 */
async function eventually(check: /**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) { assert.ok(Date.now() < deadline); await delay(5); }
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: worker result is returned only after physical retirement and all dimensions are released
 * 协作入口 / Collaborators: `registry`, `assert.equal`, `runtime.run`, `host.snapshot`.
 * 检查边界 / Checked boundaries: `assert.equal(await runtime.run(options, () => result()), 42)`; `assert.equal(host.snapshot().resources.length, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('worker result is returned only after physical retirement and all dimensions are released', async () => {
  const host = registry(), runtime = new ComputeRuntime(host);
  try {
    assert.equal(await runtime.run(options, () => result()), 42);
    assert.equal(host.snapshot().resources.length, 0);
    assert.ok(host.snapshot().budgets.every((budget) => !budget.used));
  } finally { await runtime.close(); host.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: queued cancellation never reads input, and close joins active workers before returning
 * 协作入口 / Collaborators: `registry`, `runtime.run`, `assert.rejects`, `eventually`.
 * 检查边界 / Checked boundaries: `assert.rejects(first, { code: 'RESOURCE_DRAINING' })`; `assert.rejects(second, { name: 'AbortError' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('queued cancellation never reads input, and close joins active workers before returning', async () => {
  const host = registry(), runtime = new ComputeRuntime(host), abort = new AbortController();
  let read = false;
  const first = runtime.run(options, () => result('while(true){}'));
  const stopped = assert.rejects(first, { code: 'RESOURCE_DRAINING' });
  await eventually(() => host.snapshot().budgets[0].used === 1);
  const second = runtime.run({ ...options, signal: abort.signal }, () => { read = true; return result(); });
  const cancelled = assert.rejects(second, { name: 'AbortError' });
  abort.abort(); await cancelled;
  assert.equal(read, false);
  await runtime.close(); await stopped;
  host.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: time limits, invalid entry points and preparation errors cannot leak compute capacity
 * 协作入口 / Collaborators: `registry`, `assert.rejects`, `runtime.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(runtime.run({ ...options, timeoutMs: 30 }, () => result('while(true){}')), { code: 'COMPUTE_TIMEOUT' })`; `assert.rejects(runtime.run(options, () => { throw new Error('input failed'); }), /input failed/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('time limits, invalid entry points and preparation errors cannot leak compute capacity', async () => {
  const host = registry(), runtime = new ComputeRuntime(host);
  try {
    await assert.rejects(runtime.run({ ...options, timeoutMs: 30 }, () => result('while(true){}')), { code: 'COMPUTE_TIMEOUT' });
    await assert.rejects(runtime.run(options, () => { throw new Error('input failed'); }), /input failed/);
    await assert.rejects(runtime.run(options, () => ({ source: 'relative-without-dot.js' })), { code: 'ERR_WORKER_PATH' });
    await assert.rejects(runtime.run(options, () => result('process.exit(0)')), { code: 'COMPUTE_EXIT' });
    assert.equal(host.snapshot().resources.length, 0);
  } finally { await runtime.close(); host.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed termination retains budget and close retries the same worker before releasing it
 * 协作入口 / Collaborators: `registry`, `Object.assign`, `assert.rejects`, `runtime.run`.
 * 检查边界 / Checked boundaries: `assert.rejects(runtime.run(options, () => result()), { code: 'COMPUTE_CLEANUP_PENDING' })`; `assert.equal(host.snapshot().resources[0].state, 'cleanup-pending')`.
 */
test('failed termination retains budget and close retries the same worker before releasing it', async () => {
  const host = registry(); let attempts = 0;
  const worker = Object.assign(new EventEmitter(), { /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`1`），以 Promise 交付。
   * Result: Return the branch-computed value (`1`) through a Promise.
   * 验证场景 / Scenario: failed termination retains budget and close retries the same worker before releasing it
   * 失败 / Failure: `new Error('exit unconfirmed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `worker.emit`.
   */
  terminate: async () => {
    if (++attempts === 1) throw new Error('exit unconfirmed');
    worker.emit('exit', 1); return 1;
  } });
  const runtime = new ComputeRuntime(host, () => {
    setImmediate(() => worker.emit('message', { ok: true, result: 1 }));
    return worker as unknown as Worker;
  });
  await assert.rejects(runtime.run(options, () => result()), { code: 'COMPUTE_CLEANUP_PENDING' });
  assert.equal(host.snapshot().resources[0].state, 'cleanup-pending');
  assert.equal(host.snapshot().budgets[0].used, 1);
  await runtime.close(); assert.equal(attempts, 2); host.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: fixed preview worker accepts bounded immutable bytes and preserves parser errors
 * 协作入口 / Collaborators: `Buffer.alloc`, `header.write`, `header.fill`, `header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(actual, expected)`; `assert.equal(hostRuntime.snapshot().resources.filter((resource) => resource.kind === 'compute-worker').length, 0)`.
 */
test('fixed preview worker accepts bounded immutable bytes and preserves parser errors', async () => {
  const header = Buffer.alloc(512); header.write('empty'); header.write('00000000000\0', 124);
  header.fill(32, 148, 156);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  const bytes = gzipSync(Buffer.concat([header, Buffer.alloc(1024)]));
  const expected = previewFile('sample.tgz', bytes);
  const actual = await previewInWorker('test:preview', 'sample.tgz', bytes.length, async () => bytes);
  assert.deepEqual(actual, expected);
  assert.equal(hostRuntime.snapshot().resources.filter((resource) => resource.kind === 'compute-worker').length, 0);
  await assert.rejects(previewInWorker('test:preview', 'broken.zip', 24, async () => Buffer.alloc(24)), /ZIP 目录无效/);
});
