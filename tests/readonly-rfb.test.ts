/**
 * 模块职责：回归验证模块，围绕 `readonly-rfb` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `readonly-rfb`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: read-only RFB passes fragmented setup and framebuffer requests unchanged; read-only RFB removes the clipboard pseudo-encoding before it reaches the guest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ReadOnlyRfb } from '../server/readonly-rfb.ts';

const version = Buffer.from('RFB 003.008\n');
const setup = Buffer.concat([version, Buffer.from([1, 1])]);
const framebufferRequest = Buffer.from([3, 0, 0, 0, 0, 0, 0, 0, 64, 64]);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: read-only RFB passes fragmented setup and framebuffer requests unchanged
 * 协作入口 / Collaborators: `filter.on`, `Buffer.alloc`, `Buffer.from`, `Buffer.concat`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(Buffer.concat(output), expected)`.
 */
test('read-only RFB passes fragmented setup and framebuffer requests unchanged', async () => {
  const filter = new ReadOnlyRfb();
  const output: Buffer[] = [];
  filter.on('data', (chunk: Buffer) => output.push(chunk));
  const pixelFormat = Buffer.alloc(20);
  const encodings = Buffer.from([2, 0, 0, 1, 0, 0, 0, 0]);
  const continuous = Buffer.from([150, 1, 0, 0, 0, 0, 0, 0, 64, 64]);
  const fence = Buffer.from([248, 0, 0, 0, 0, 0, 0, 1, 2, 65, 66]);
  const expected = Buffer.concat([setup, pixelFormat, encodings, framebufferRequest, continuous, fence]);
  filter.write(expected.subarray(0, 4));
  filter.write(expected.subarray(4, 13));
  filter.write(expected.subarray(13, 25));
  filter.end(expected.subarray(25));
  await once(filter, 'end');
  assert.deepEqual(Buffer.concat(output), expected);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: read-only RFB removes the clipboard pseudo-encoding before it reaches the guest
 * 协作入口 / Collaborators: `filter.on`, `Buffer.from`, `filter.end`, `Buffer.concat`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(Buffer.concat(output), Buffer.concat([ setup, Buffer.from([2, 0, 0, 1, 0, 0, 0, 0]), ]))`.
 */
test('read-only RFB removes the clipboard pseudo-encoding before it reaches the guest', async () => {
  const filter = new ReadOnlyRfb();
  const output: Buffer[] = [];
  filter.on('data', (chunk: Buffer) => output.push(chunk));
  const encodings = Buffer.from([2, 0, 0, 2, 0, 0, 0, 0, 0xc0, 0xa1, 0xe5, 0xce]);
  filter.end(Buffer.concat([setup, encodings]));
  await once(filter, 'end');
  assert.deepEqual(Buffer.concat(output), Buffer.concat([
    setup, Buffer.from([2, 0, 0, 1, 0, 0, 0, 0]),
  ]));
});

for (const [name, input] of [
  ['keyboard', Buffer.from([4, 1, 0, 0, 0, 0, 0, 65])],
  ['pointer', Buffer.from([5, 1, 0, 10, 0, 20])],
  ['clipboard', Buffer.from([6, 0, 0, 0, 0, 0, 0, 1, 65])],
  ['desktop resize', Buffer.from([251, 0, 0, 0])],
  ['unknown extension', Buffer.from([255, 0])],
  ['fence request', Buffer.from([248, 0, 0, 0, 128, 0, 0, 0, 0])],
] as const)
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `filter.on`, `filter.write`, `assert.match`, `assert.deepEqual`.
   * 检查边界 / Checked boundaries: `assert.match((await error).message, /forbidden|fence/)`; `assert.deepEqual(Buffer.concat(output), setup)`.
   */
  test(`read-only RFB rejects ${name} before forwarding any input`, async () => {
    const filter = new ReadOnlyRfb();
    const output: Buffer[] = [];
    filter.on('data', (chunk: Buffer) => output.push(chunk));
    filter.write(setup);
    const error = new Promise<Error>((resolve) => filter.once('error', resolve));
    filter.write(input);
    assert.match((await error).message, /forbidden|fence/);
    assert.deepEqual(Buffer.concat(output), setup);
  });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: read-only RFB rejects security negotiation and oversized encoding requests
 * 协作入口 / Collaborators: `security.write`, `Buffer.from`, `assert.match`, `encoding.write`.
 * 检查边界 / Checked boundaries: `assert.match((await denied).message, /no-auth/)`; `assert.match((await tooMany).message, /encodings/)`.
 */
test('read-only RFB rejects security negotiation and oversized encoding requests', async () => {
  const security = new ReadOnlyRfb();
  security.write(version);
  const denied = new Promise<Error>((resolve) => security.once('error', resolve));
  security.write(Buffer.from([2]));
  assert.match((await denied).message, /no-auth/);

  const encoding = new ReadOnlyRfb();
  encoding.write(setup);
  const tooMany = new Promise<Error>((resolve) => encoding.once('error', resolve));
  encoding.write(Buffer.from([2, 0, 1, 1]));
  assert.match((await tooMany).message, /encodings/);
});
