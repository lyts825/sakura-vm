/**
 * 模块职责：回归验证模块，围绕 `secure-erase` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `secure-erase`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: logical erase requires a current project file, a separate preview and explicit confirmation; guest output cannot claim a successful erase without a matching verified record.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSecureErase, runSecureErase, secureEraseInput } from '../server/secure-erase.ts';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: logical erase requires a current project file, a separate preview and explicit confirmation
 * 协作入口 / Collaborators: `assert.equal`, `secureEraseInput.safeParse`, `'a'.repeat`, `checkSecureErase`.
 * 检查边界 / Checked boundaries: `assert.equal(secureEraseInput.safeParse({ mode: 'preview', path: '../secret' }).success, false)`; `assert.equal(secureEraseInput.safeParse({ mode: 'preview', path: 'folder\\secret' }).success, false)`.
 */
test('logical erase requires a current project file, a separate preview and explicit confirmation', async () => {
  let commands = 0;
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: logical erase requires a current project file, a separate preview and explicit confirmation
     */
    state: () => 'running', /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: logical erase requires a current project file, a separate preview and explicit confirmation
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: logical erase requires a current project file, a separate preview and explicit confirmation
     */
    exec: async () => { commands++; return { code: 0, stdout: '', stderr: '' }; },
  } as unknown as Machines;
  const unsafe = { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ directory: '/etc' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ directory: '/etc' })`) through a Promise.
   * 验证场景 / Scenario: logical erase requires a current project file, a separate preview and explicit confirmation
   */
  config: async () => ({ directory: '/etc' }) } as unknown as Workspaces;
  assert.equal(secureEraseInput.safeParse({ mode: 'preview', path: '../secret' }).success, false);
  assert.equal(secureEraseInput.safeParse({ mode: 'preview', path: 'folder\\secret' }).success, false);
  assert.equal(secureEraseInput.safeParse({ mode: 'erase', path: 'file',
    previewToken: 'a'.repeat(64), confirmed: false }).success, false);
  assert.equal((await checkSecureErase(machines, unsafe, 'vm')).ready, false);
  await assert.rejects(runSecureErase(machines, unsafe, 'vm',
    { mode: 'preview', path: 'passwd' }), /\/workspace/);
  assert.equal(commands, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: guest output cannot claim a successful erase without a matching verified record
 * 协作入口 / Collaborators: `assert.rejects`, `runSecureErase`, `'a'.repeat`.
 * 检查边界 / Checked boundaries: `assert.rejects(runSecureErase(machines, workspaces, 'vm', { mode: 'erase', path: 'target', previewToken: 'a'.repeat(64), confirmed…`.
 */
test('guest output cannot claim a successful erase without a matching verified record', async () => {
  const workspaces = { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ directory: '/workspace' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ directory: '/workspace' })`) through a Promise.
   * 验证场景 / Scenario: guest output cannot claim a successful erase without a matching verified record
   */
  config: async () => ({ directory: '/workspace' }) } as unknown as Workspaces;
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: guest output cannot claim a successful erase without a matching verified record
     */
    state: () => 'running', /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: guest output cannot claim a successful erase without a matching verified record
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ code: 0, stdout: JSON.stringify({ path: '/workspace/other', bytes: 1, sha256B…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 0, stdout: JSON.stringify({ path: '/workspace/other', bytes: 1, sha256B…`) through a Promise.
     * 验证场景 / Scenario: guest output cannot claim a successful erase without a matching verified record
     * 协作入口 / Collaborators: `JSON.stringify`, `'a'.repeat`, `'b'.repeat`, `new Date().toISOString`.
     */
    exec: async () => ({ code: 0, stdout: JSON.stringify({ path: '/workspace/other',
      bytes: 1, sha256Before: 'a'.repeat(64), sha256After: 'b'.repeat(64),
      passes: 3, removed: true, recordedAt: new Date().toISOString() }), stderr: '' }),
  } as unknown as Machines;
  await assert.rejects(runSecureErase(machines, workspaces, 'vm',
    { mode: 'erase', path: 'target', previewToken: 'a'.repeat(64), confirmed: true }),
  /记录无效/);
});
