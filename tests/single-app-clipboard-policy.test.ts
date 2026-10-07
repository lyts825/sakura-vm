/**
 * 模块职责：回归验证模块，围绕 `single-app-clipboard-policy` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `single-app-clipboard-policy`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: per-program clipboard rules persist and corrupt state cannot silently allow a launch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setVmStorageRoot } from '../server/model.ts';
import { SingleAppWindows } from '../server/single-app-windows.ts';
import type { Machines } from '../server/machines.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: per-program clipboard rules persist and corrupt state cannot silently allow a launch
 * 失败 / Failure: `new Error('unsafe policy test cleanup')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await first.clipboardPolicies(id), {})`; `assert.deepEqual((await reopened.clipboardPolicies(id)).xterm, { copy: false, paste: true })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('per-program clipboard rules persist and corrupt state cannot silently allow a launch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-single-app-policy-'));
  const id = randomUUID();
  setVmStorageRoot(id, root);
  const machines = Object.assign(new EventEmitter(), {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id })`）。
     * Result: Return the branch-computed value (`({ id })`).
     * 验证场景 / Scenario: per-program clipboard rules persist and corrupt state cannot silently allow a launch
     */
    get: () => ({ id }), /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: per-program clipboard rules persist and corrupt state cannot silently allow a launch
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _key: string; task: () => Promise<unknown>。
     * 结果：返回分支计算值（`task()`），以 Promise 交付。
     * Result: Return the branch-computed value (`task()`) through a Promise.
     * 验证场景 / Scenario: per-program clipboard rules persist and corrupt state cannot silently allow a launch
     * 协作入口 / Collaborators: `task`.
     */
    locked: async (_key: string, task: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => task(),
    records: new Map([[id, { id }]]), /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'stopped'`）。
     * Result: Return the branch-computed value (`'stopped'`).
     * 验证场景 / Scenario: per-program clipboard rules persist and corrupt state cannot silently allow a launch
     */
    state: () => 'stopped',
  }) as unknown as Machines;
  const first = new SingleAppWindows(machines);
  const reopened = new SingleAppWindows(machines);
  try {
    assert.deepEqual(await first.clipboardPolicies(id), {});
    await first.saveClipboardPolicy(id, 'xterm', { copy: false, paste: true });
    assert.deepEqual((await reopened.clipboardPolicies(id)).xterm,
      { copy: false, paste: true });
    await assert.rejects(first.saveClipboardPolicy(id, 'xterm',
      { copy: 'false', paste: true }));
    assert.equal((await reopened.clipboardPolicies(id)).xterm.copy, false);
    await reopened.removeClipboardPolicy(id, 'xterm');
    assert.deepEqual(await first.clipboardPolicies(id), {});
    await writeFile(join(root, id, 'single-app-clipboard.json'), '{broken');
    await assert.rejects(first.clipboardPolicies(id));
    await assert.rejects(first.saveClipboardPolicy(id, 'xterm',
      { copy: true, paste: true }));
  } finally {
    await first.close();
    await reopened.close();
    setVmStorageRoot(id);
    const path = await realpath(root);
    if (dirname(path) !== resolve(tmpdir()) ||
        !basename(path).startsWith('sakura-single-app-policy-'))
      throw new Error('unsafe policy test cleanup');
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
