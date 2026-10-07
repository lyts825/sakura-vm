/**
 * 模块职责：回归验证模块，围绕 `network-pool-review` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `network-pool-review`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: pool shutdown is shared, revokes pins and refuses capabilities after release; worker preserves the complete EOF tail when the receiver starts late.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { HostNetworkPool } from '../server/network/host-pool.ts';

/**
 * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
 * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`new HostNetworkPool({ maxWorkers: 1, connectionsPerWorker: 4, scaleAt: 4, idleMs…`）。
 * Result: Return the branch-computed value (`new HostNetworkPool({ maxWorkers: 1, connectionsPerWorker: 4, scaleAt: 4, idleMs…`).
 */
const createPool = () =>
  new HostNetworkPool({ maxWorkers: 1, connectionsPerWorker: 4, scaleAt: 4, idleMs: 60_000 });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pool shutdown is shared, revokes pins and refuses capabilities after release
 * 协作入口 / Collaborators: `createPool`, `pool.pin`, `released.call`, `released.release`.
 * 检查边界 / Checked boundaries: `assert.rejects(released.call('lookup', { hostname: 'localhost', options: {} }), /released/)`; `assert.equal(pool.close(), close)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('pool shutdown is shared, revokes pins and refuses capabilities after release', async () => {
  const pool = createPool();
  let revoked = 0;
  const released = pool.pin(() => assert.fail('Released pin must not receive failure'));
  await released.call('lookup', { hostname: 'localhost', options: {} });
  released.release();
  await assert.rejects(released.call('lookup', { hostname: 'localhost', options: {} }), /released/);
  pool.pin(() => revoked++);
  const close = pool.close();
  assert.equal(pool.close(), close);
  await close;
  assert.equal(revoked, 1);
  assert.deepEqual(pool.snapshot(), []);
  await assert.rejects(pool.lookup('localhost', {}), /closed/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: worker preserves the complete EOF tail when the receiver starts late
 * 状态影响 / State effects: `size`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomBytes`, `createHash('sha256').update(payload).digest`, `createHash('sha256').update`, `createHash`.
 * 检查边界 / Checked boundaries: `assert.equal(size, payload.length)`; `assert.equal(hash.digest('hex'), expected)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('worker preserves the complete EOF tail when the receiver starts late', async () => {
  const payload = randomBytes(4 * 1024 * 1024);
  const expected = createHash('sha256').update(payload).digest('hex');
  const peer = createServer({ allowHalfOpen: true }, (socket) => {
    socket.on('error', () => {});
    socket.end(payload);
    socket.resume();
  });
  await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
  const pool = createPool();
  try {
    const socket = await pool.dial({ host: '127.0.0.1', port: (peer.address() as { port: number }).port });
    socket.end();
    await delay(100);
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of socket) {
      hash.update(chunk);
      size += chunk.length;
    }
    assert.equal(size, payload.length);
    assert.equal(hash.digest('hex'), expected);
  } finally {
    await pool.close();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancelled DNS lookup refuses before starting a worker
 * 协作入口 / Collaborators: `createPool`, `assert.rejects`, `pool.lookup`, `AbortSignal.abort`.
 * 检查边界 / Checked boundaries: `assert.rejects( pool.lookup('localhost', {}, AbortSignal.abort(reason)), (error) => error === reason, )`; `assert.deepEqual(pool.snapshot(), [])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('cancelled DNS lookup refuses before starting a worker', async () => {
  const pool = createPool();
  const reason = new Error('scope disposed');
  try {
    await assert.rejects(
      pool.lookup('localhost', {}, AbortSignal.abort(reason)),
      (error) => error === reason,
    );
    assert.deepEqual(pool.snapshot(), []);
  } finally {
    await pool.close();
  }
});
