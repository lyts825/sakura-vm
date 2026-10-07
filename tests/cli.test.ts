/**
 * 模块职责：回归验证模块，围绕 `cli` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `cli`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: failed CLI exports remove the partial output so the same filename can be retried; CLI export rejects an existing destination before starting disk preparation.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext; fail: boolean。
 * 结果：返回受控对象，公开字段包括 `run, destination, exports`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `run, destination, exports`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `createServer`, `http.listen`, `once`, `mkdtemp`.
 */
async function fixture(t: TestContext, fail: boolean) {
  let exports = 0;
  const http = createServer((req, res) => {
    if (req.url === '/api/bootstrap') res.end(JSON.stringify({ token: 'test' }));
    else if (req.url === '/api/vms') res.end(JSON.stringify([{ id: 'vm', name: 'example' }]));
    else if (req.url === '/api/vms/vm/export') {
      exports++;
      res.writeHead(200, { 'Content-Length': '32' });
      if (fail) {
        res.write('partial');
        setTimeout(() => res.destroy(), 25);
      } else res.end(Buffer.alloc(32, 1));
    } else res.writeHead(404).end();
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const directory = await mkdtemp(join(tmpdir(), 'sakura-cli-test-'));
  t.after(async () => {
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('sakura-cli-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  const destination = join(directory, 'output.sakura');
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `code, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stderr`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `spawn`, `resolve`, `String`, `http.address`.
   */
  const run = async () => {
    const child = spawn(process.execPath, [resolve('scripts/cli.mjs'), 'export', 'example', destination], {
      windowsHide: true,
      env: { ...process.env, SAKURA_PORT: String((http.address() as { port: number }).port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    const [code] = await once(child, 'exit');
    return { code, stderr };
  };
  return { run, destination, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`exports`）。
   * Result: Return the branch-computed value (`exports`).
   */
  exports: () => exports };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed CLI exports remove the partial output so the same filename can be retried
 * 协作入口 / Collaborators: `fixture`, `run`, `assert.equal`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.equal(result.code, 1, result.stderr)`; `assert.rejects(stat(destination), { code: 'ENOENT' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('failed CLI exports remove the partial output so the same filename can be retried', async (t) => {
  const { run, destination, exports } = await fixture(t, true);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await run();
    assert.equal(result.code, 1, result.stderr);
    await assert.rejects(stat(destination), { code: 'ENOENT' });
  }
  assert.equal(exports(), 2);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: CLI export rejects an existing destination before starting disk preparation
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `assert.equal`, `run`.
 * 检查边界 / Checked boundaries: `assert.equal((await run()).code, 1)`; `assert.equal(await readFile(destination, 'utf8'), 'keep this backup')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('CLI export rejects an existing destination before starting disk preparation', async (t) => {
  const { run, destination, exports } = await fixture(t, false);
  await writeFile(destination, 'keep this backup');
  assert.equal((await run()).code, 1);
  assert.equal(await readFile(destination, 'utf8'), 'keep this backup');
  assert.equal(exports(), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: successful CLI exports keep the complete original binary bytes
 * 协作入口 / Collaborators: `fixture`, `run`, `assert.equal`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(result.code, 0, result.stderr)`; `assert.deepEqual(await readFile(destination), Buffer.alloc(32, 1))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('successful CLI exports keep the complete original binary bytes', async (t) => {
  const { run, destination, exports } = await fixture(t, false);
  const result = await run();
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await readFile(destination), Buffer.alloc(32, 1));
  assert.equal(exports(), 1);
});
