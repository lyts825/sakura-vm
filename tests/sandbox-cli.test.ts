/**
 * 模块职责：回归验证模块，围绕 `sandbox-cli` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `sandbox-cli`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: sandbox CLI keeps shell syntax inside quoted guest arguments; sandbox CLI retrieves execution history after the VM has been destroyed.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
// @ts-expect-error JavaScript CLI modules intentionally have no declaration file.
import { sandboxCommand } from '../scripts/sandbox-cli.mjs';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: sandbox CLI keeps shell syntax inside quoted guest arguments
 * 协作入口 / Collaborators: `sandboxCommand`, `assert.equal`, `assert.deepEqual`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.equal(result.handled, true)`; `assert.deepEqual(calls[1], { path: '/vms/id/sandbox/run', method: 'POST', body: { command: "'printf' '%s' 'a'\\''b $(host)'" }, })`.
 */
test('sandbox CLI keeps shell syntax inside quoted guest arguments', async () => {
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: path: string; method: string; body: unknown。
   * 结果：返回分支计算值（`path === '/sandboxes' ? { sandboxes: [{ id: 'id', name: 'sample' }], runs: [] } …`），以 Promise 交付。
   * Result: Return the branch-computed value (`path === '/sandboxes' ? { sandboxes: [{ id: 'id', name: 'sample' }], runs: [] } …`) through a Promise.
   * 验证场景 / Scenario: sandbox CLI keeps shell syntax inside quoted guest arguments
   * 协作入口 / Collaborators: `calls.push`.
   */
  const api = async (path: string, method?: string, body?: unknown) => {
    calls.push({ path, method, body });
    return path === '/sandboxes' ? { sandboxes: [{ id: 'id', name: 'sample' }], runs: [] } : { id: 'job' };
  };
  const result = await sandboxCommand('sandbox', 'run', ['sample', '--', 'printf', '%s', "a'b $(host)"], api);
  assert.equal(result.handled, true);
  assert.deepEqual(calls[1], {
    path: '/vms/id/sandbox/run',
    method: 'POST',
    body: { command: "'printf' '%s' 'a'\\''b $(host)'" },
  });
  await assert.rejects(sandboxCommand('sandbox', 'destroy', ['ordinary'], api), /Sandbox not found/);
  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: sandbox CLI retrieves execution history after the VM has been destroyed
 * 协作入口 / Collaborators: `assert.deepEqual`, `sandboxCommand`.
 * 检查边界 / Checked boundaries: `assert.deepEqual((await sandboxCommand('sandbox', 'logs', ['sample'], api)).value, [job])`; `assert.deepEqual((await sandboxCommand('sandbox', 'logs', ['deleted'], api)).value, [job])`.
 */
test('sandbox CLI retrieves execution history after the VM has been destroyed', async () => {
  const job = { vmId: 'deleted', title: 'sample · 沙箱命令', status: 'done', log: 'kept' };
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ sandboxes: [], runs: [job] })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ sandboxes: [], runs: [job] })`) through a Promise.
   * 验证场景 / Scenario: sandbox CLI retrieves execution history after the VM has been destroyed
   */
  const api = async () => ({ sandboxes: [], runs: [job] });
  assert.deepEqual((await sandboxCommand('sandbox', 'logs', ['sample'], api)).value, [job]);
  assert.deepEqual((await sandboxCommand('sandbox', 'logs', ['deleted'], api)).value, [job]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: sandbox CLI exports verified binary artifacts without overwriting an existing file
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Buffer.from`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await readFile(output), bytes)`; `assert.rejects(sandboxCommand('sandbox', 'artifact', ['run', 'artifact', output], api), { code: 'EEXIST', })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('sandbox CLI exports verified binary artifacts without overwriting an existing file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-sandbox-cli-'));
  try {
    const bytes = Buffer.from([0, 255, 7]),
      output = join(directory, 'output.bin');
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ base64: bytes.toString('base64'), bytes: bytes.length, sha256: createHash('sh…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ base64: bytes.toString('base64'), bytes: bytes.length, sha256: createHash('sh…`) through a Promise.
     * 验证场景 / Scenario: sandbox CLI exports verified binary artifacts without overwriting an existing file
     * 协作入口 / Collaborators: `bytes.toString`, `createHash('sha256').update(bytes).digest`, `createHash('sha256').update`, `createHash`.
     */
    const api = async () => ({
      base64: bytes.toString('base64'),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    await sandboxCommand('sandbox', 'artifact', ['run', 'artifact', output], api);
    assert.deepEqual(await readFile(output), bytes);
    await assert.rejects(sandboxCommand('sandbox', 'artifact', ['run', 'artifact', output], api), {
      code: 'EEXIST',
    });
    const config = join(directory, 'run.json'),
      submitted: unknown[] = [];
    await writeFile(config, JSON.stringify({ command: 'pwd', artifacts: ['output.bin'] }));
    await sandboxCommand(
      'sandbox',
      'run-config',
      ['sample', config],
      async (path: string, _method: string, body: unknown) => {
        if (path === '/sandboxes') return { sandboxes: [{ id: 'id', name: 'sample' }] };
        submitted.push(body);
        return {};
      },
    );
    assert.deepEqual(submitted, [{ command: 'pwd', artifacts: ['output.bin'] }]);
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('sakura-sandbox-cli-'));
    await rm(directory, { recursive: true, force: true });
  }
});
