/**
 * 模块职责：回归验证模块，围绕 `native-process-retirement` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `native-process-retirement`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: native spawn failure waits for close without inventing a live child tree.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { runViaNativeHost } from '../.vendor/posixloom/dist/src/core/process/native.js';
import {
  encodeNativeFrame,
  NATIVE_MAX_FRAME_BYTES,
} from '../.vendor/posixloom/dist/src/core/process/protocol.js';

for (const receipt of [false, true])
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: context。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `Object.assign`, `context.mock.method`, `syncBuiltinESMExports`, `context.after`.
   * 检查边界 / Checked boundaries: `assert.ok(kills >= 1)`; `assert.equal(completed, false, 'kill/terminal frame is insufficient without host close')`.
   */
  test(`native cancellation waits for close and ${receipt ? 'accepts' : 'requires'} a retirement receipt`, async (context) => {
    let kills = 0;
    const child = Object.assign(new EventEmitter(), {
      pid: 1234,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回布尔判定，供用例选择路径或核对受控条件。
       * Result: Return a boolean decision for path selection or controlled-condition assertions.
       */
      kill() {
        kills++;
        return true;
      },
    });
    context.mock.method(childProcess, 'spawn', () => child);
    syncBuiltinESMExports();
    context.after(() => {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const abort = new AbortController();
    let completed = false;
    const result = runViaNativeHost({
      hostPath: 'fixture',
      program: 'fixture',
      args: [],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      cancelGraceMs: 1,
      signal: abort.signal,
    });
    void result.then(() => {
      completed = true;
    });
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: data: object。
     * 结果：返回分支计算值（`child.stdout.write(encodeNativeFrame({ protocolVersion: 1, ...data }))`）。
     * Result: Return the branch-computed value (`child.stdout.write(encodeNativeFrame({ protocolVersion: 1, ...data }))`).
     * 协作入口 / Collaborators: `child.stdout.write`, `encodeNativeFrame`.
     */
    const frame = (data: object) => child.stdout.write(encodeNativeFrame({ protocolVersion: 1, ...data }));
    frame({ type: 'hello', maxFrameBytes: NATIVE_MAX_FRAME_BYTES });
    frame({ type: 'started', pid: 4321 });
    abort.abort();
    if (receipt) frame({ type: 'exit', outcome: 'cancelled', code: 130 });
    await delay(10);
    assert.ok(kills >= 1);
    assert.equal(completed, false, 'kill/terminal frame is insufficient without host close');
    child.emit('close', 0, null);
    assert.deepEqual(
      (await result).outcome,
      receipt ? { kind: 'cancelled' } : { kind: 'crashed', errorCode: 'NATIVE_HOST_CLEANUP_UNCONFIRMED' },
    );
  });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: context。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native spawn failure waits for close without inventing a live child tree
 * 协作入口 / Collaborators: `Object.assign`, `context.mock.method`, `syncBuiltinESMExports`, `context.after`.
 * 检查边界 / Checked boundaries: `assert.equal(completed, false)`; `assert.deepEqual((await result).outcome, { kind: 'spawn-failed', errorCode: 'ENOENT' })`.
 */
test('native spawn failure waits for close without inventing a live child tree', async (context) => {
  const child = Object.assign(new EventEmitter(), {
    pid: undefined,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回布尔判定，供用例选择路径或核对受控条件。
     * Result: Return a boolean decision for path selection or controlled-condition assertions.
     * 验证场景 / Scenario: native spawn failure waits for close without inventing a live child tree
     */
    kill() {
      return false;
    },
  });
  context.mock.method(childProcess, 'spawn', () => child);
  syncBuiltinESMExports();
  context.after(() => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });
  let completed = false;
  const result = runViaNativeHost({
    hostPath: 'fixture',
    program: 'fixture',
    args: [],
    cwd: process.cwd(),
    env: {},
    timeoutMs: 5000,
    maxOutputBytes: 1024,
  });
  void result.then(() => {
    completed = true;
  });
  child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
  await delay(0);
  assert.equal(completed, false);
  child.emit('close', -1, null);
  assert.deepEqual((await result).outcome, { kind: 'spawn-failed', errorCode: 'ENOENT' });
});
