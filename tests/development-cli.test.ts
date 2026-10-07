/**
 * 模块职责：回归验证模块，围绕 `development-cli` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `development-cli`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: CLI preserves Git paths and command parameters as structured data; CLI applies the reviewed network and migration tokens without silently replanning.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const modulePath = '../scripts/development-cli.mjs';
const { developmentCommand } = await import(modulePath);
const root = await mkdtemp(join(tmpdir(), 'sakura-dev-cli-'));
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(root, /sakura-dev-cli-/);
  await rm(root, { recursive: true, force: true });
});
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `calls, run`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `calls, run`; the actual branch determines its shape.
 */
function fixture() {
  const calls: { path: string; method: string; body: any }[] = [];
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: path: string; method = 'GET'; body: unknown。
   * 结果：返回分支计算值（`path === '/vms' ? [{ id: 'vm-id', name: 'example' }] : { ok: true }`），以 Promise 交付。
   * Result: Return the branch-computed value (`path === '/vms' ? [{ id: 'vm-id', name: 'example' }] : { ok: true }`) through a Promise.
   * 协作入口 / Collaborators: `calls.push`.
   */
  const api = async (path: string, method = 'GET', body?: unknown) => {
    calls.push({ path, method, body });
    return path === '/vms' ? [{ id: 'vm-id', name: 'example' }] : { ok: true };
  };
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: action: string; name: string; args: string[] = []。
   * 结果：返回分支计算值（`developmentCommand(action, name, args, api, 'http://127.0.0.1:7339')`）。
   * Result: Return the branch-computed value (`developmentCommand(action, name, args, api, 'http://127.0.0.1:7339')`).
   * 协作入口 / Collaborators: `developmentCommand`.
   */
  const run = (action: string, name: string, args: string[] = []) =>
    developmentCommand(action, name, args, api, 'http://127.0.0.1:7339');
  return { calls, run };
}
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: CLI preserves Git paths and command parameters as structured data
 * 协作入口 / Collaborators: `fixture`, `run`, `assert.deepEqual`, `calls.at`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(calls.at(-1), { path: '/vms/vm-id/git', method: 'POST', body: { action: 'stage', paths: ['a b.txt', 'a;echo.txt']…`; `assert.deepEqual(calls.at(-1)?.body.values, { TARGET: 'one two;$HOME' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('CLI preserves Git paths and command parameters as structured data', async () => {
  const { calls, run } = fixture();
  await run('git', 'example', ['stage', 'a b.txt', 'a;echo.txt']);
  assert.deepEqual(calls.at(-1), {
    path: '/vms/vm-id/git',
    method: 'POST',
    body: { action: 'stage', paths: ['a b.txt', 'a;echo.txt'] },
  });
  const file = join(root, 'values.json');
  await writeFile(file, JSON.stringify({ TARGET: 'one two;$HOME' }));
  await run('commands', 'example', ['run', 'preset-id', file]);
  assert.deepEqual(calls.at(-1)?.body.values, { TARGET: 'one two;$HOME' });
  await run('project-files', 'example', ['hello world', '--content']);
  assert.match(calls.at(-1)!.path, /q=hello%20world&content=1$/);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: CLI applies the reviewed network and migration tokens without silently replanning
 * 状态影响 / State effects: `calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `join`, `writeFile`, `JSON.stringify`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(calls.at(-1)?.body, { action: 'apply', token: 'reviewed', config: { httpProxy: '' } })`; `assert.deepEqual(calls, [ { path: '/migration', method: 'POST', body: { action: 'start', target: 'E:\\New Data', token: 'reviewed'…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('CLI applies the reviewed network and migration tokens without silently replanning', async () => {
  const { calls, run } = fixture(),
    file = join(root, 'preview.json');
  await writeFile(
    file,
    JSON.stringify({ token: 'reviewed', target: 'E:\\New Data', config: { httpProxy: '' } }),
  );
  await run('network', 'example', ['apply', file]);
  assert.deepEqual(calls.at(-1)?.body, { action: 'apply', token: 'reviewed', config: { httpProxy: '' } });
  calls.length = 0;
  await run('migration', 'start', [file]);
  assert.deepEqual(calls, [
    {
      path: '/migration',
      method: 'POST',
      body: { action: 'start', target: 'E:\\New Data', token: 'reviewed' },
    },
  ]);
  await assert.rejects(run('network', 'example', ['unrecognized']), /Unknown network action/);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: CLI secrets require the dedicated environment variable and never accept a positional value
 * 状态影响 / State effects: `process.env.SAKURA_SECRET_VALUE`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `run`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects( run('secrets', 'example', ['put', 'token', 'unsafe-positional-value']), /SAKURA_SECRET_VALUE/, )`; `assert.deepEqual(calls.at(-1)?.body, { name: 'token', value: 'test-value' })`.
 */
test('CLI secrets require the dedicated environment variable and never accept a positional value', async () => {
  const previous = process.env.SAKURA_SECRET_VALUE,
    { calls, run } = fixture();
  try {
    delete process.env.SAKURA_SECRET_VALUE;
    await assert.rejects(
      run('secrets', 'example', ['put', 'token', 'unsafe-positional-value']),
      /SAKURA_SECRET_VALUE/,
    );
    process.env.SAKURA_SECRET_VALUE = 'test-value';
    const result = await run('secrets', 'example', ['put', 'token']);
    assert.deepEqual(calls.at(-1)?.body, { name: 'token', value: 'test-value' });
    assert.ok(!JSON.stringify(result).includes('test-value'));
  } finally {
    if (previous === undefined) delete process.env.SAKURA_SECRET_VALUE;
    else process.env.SAKURA_SECRET_VALUE = previous;
  }
});
