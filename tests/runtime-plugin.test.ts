/**
 * 模块职责：回归验证模块，围绕 `runtime-plugin` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `runtime-plugin`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: runtime install route forwards only its strict installation body and rejects extra probe fields; runtime CLI inspect only reads the sample while probe makes one explicit authenticated request.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { PluginContext } from '../server/plugin-api.ts';
import { route } from '../plugins/runtimes/server.ts';

/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`Object.assign(new EventEmitter(), { status: 0, payload: null as unknown, writeHe…`）。
 * Result: Return the branch-computed value (`Object.assign(new EventEmitter(), { status: 0, payload: null as unknown, writeHe…`).
 * 协作入口 / Collaborators: `Object.assign`.
 */
function response() {
  return Object.assign(new EventEmitter(), {
    status: 0, payload: null as unknown,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: status: number。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `this.status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    writeHead(status: number) { this.status = status; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `this.payload`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `JSON.parse`.
     */
    end(value: string) { this.payload = JSON.parse(value); },
  }) as unknown as ServerResponse & { status: number; payload: unknown };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: runtime install route forwards only its strict installation body and rejects extra probe fields
 * 协作入口 / Collaborators: `z.object({ tool: z.enum(['node', 'python']), version: z.string() }).strict`, `z.object`, `z.enum`, `z.string`.
 * 检查边界 / Checked boundaries: `assert.equal(await route.call(host, req, res, url, async () => ({ action: 'install', tool: 'python', version: '3.12.0' }), new Abo…`; `assert.equal(res.status, 202)`.
 */
test('runtime install route forwards only its strict installation body and rejects extra probe fields', async () => {
  const schema = z.object({ tool: z.enum(['node', 'python']), version: z.string() }).strict();
  const installed: unknown[] = [], host = {
    vm: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({})`）。
     * Result: Return the branch-computed value (`({})`).
     * 验证场景 / Scenario: runtime install route forwards only its strict installation body and rejects extra probe fields
     */
    get: () => ({}) },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: reference: { pluginId: string; key: string }。
     * 结果：返回受控对象，公开字段包括 `install`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `install`; the actual branch determines its shape.
     * 验证场景 / Scenario: runtime install route forwards only its strict installation body and rejects extra probe fields
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(reference.pluginId, 'runtimes')`; `assert.equal(reference.key, 'runtimes')`.
     */
    use(reference: { pluginId: string; key: string }) {
      assert.equal(reference.pluginId, 'runtimes');
      assert.equal(reference.key, 'runtimes');
      return { /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: _id: string; input: unknown。
       * 结果：返回受控对象，公开字段包括 `status`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `status`; the actual branch determines its shape.
       * 验证场景 / Scenario: runtime install route forwards only its strict installation body and rejects extra probe fields
       * 协作入口 / Collaborators: `installed.push`, `schema.parse`.
       */
      install: async (_id: string, input: unknown) => { installed.push(schema.parse(input)); return { status: 'running' }; } };
    },
  } as unknown as PluginContext;
  const req = Object.assign(new EventEmitter(), { method: 'POST' }) as IncomingMessage;
  const url = new URL('http://localhost/api/vms/vm/runtimes'), res = response();
  assert.equal(await route.call(host, req, res, url, async () => ({ action: 'install', tool: 'python', version: '3.12.0' }), new AbortController().signal), true);
  assert.equal(res.status, 202);
  assert.deepEqual(installed, [{ tool: 'python', version: '3.12.0' }]);
  await assert.rejects(route.call(host, req, response(), url, async () => ({ action: 'probe', tool: 'node' }), new AbortController().signal), z.ZodError);
  assert.equal(installed.length, 1);
});

for (const action of ['probe', 'select'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `Object.assign`, `response`, `route.call`, `assert.rejects`.
   * 检查边界 / Checked boundaries: `assert.rejects(pending, { name: 'AbortError' })`; `assert.equal(res.status, 0)`.
   */
  test(`runtime ${action} route passes request cancellation into the operation without reporting success`, async () => {
    const controller = new AbortController();
    let entered!: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    /**
     * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
     * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
     * 输入 / Inputs: _id: string; inputOrSignal: unknown; optionalSignal: AbortSignal。
     * 结果：返回受控对象，公开字段包括 `unexpected`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `unexpected`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.deepEqual`, `assert.equal`, `entered`.
     * 检查边界 / Checked boundaries: `assert.deepEqual(inputOrSignal, {})`; `assert.equal(signal, controller.signal)`.
     */
    const wait = async (_id: string, inputOrSignal: unknown, optionalSignal?: AbortSignal) => {
      const signal = action === 'probe' ? inputOrSignal as AbortSignal : optionalSignal!;
      if (action === 'select') assert.deepEqual(inputOrSignal, {});
      assert.equal(signal, controller.signal); entered();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return { unexpected: 'success' };
    };
    const host = {
      vm: { /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`({})`）。
       * Result: Return the branch-computed value (`({})`).
       */
      get: () => ({}) },
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: reference: { pluginId: string; key: string }。
       * 结果：返回受控对象，公开字段包括 `[action]`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `[action]`; the actual branch determines its shape.
       * 协作入口 / Collaborators: `assert.equal`.
       * 检查边界 / Checked boundaries: `assert.equal(reference.pluginId, 'runtimes')`; `assert.equal(reference.key, 'runtimes')`.
       */
      use(reference: { pluginId: string; key: string }) {
        assert.equal(reference.pluginId, 'runtimes');
        assert.equal(reference.key, 'runtimes');
        return { [action]: wait };
      },
    } as unknown as PluginContext;
    const req = Object.assign(new EventEmitter(), { method: 'POST' }) as IncomingMessage, res = response();
    const pending = route.call(host, req, res, new URL('http://localhost/api/vms/vm/runtimes'), async () => ({ action }), controller.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await ready; controller.abort(); await rejected;
    assert.equal(res.status, 0); assert.equal(res.payload, null);
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: runtime CLI inspect only reads the sample while probe makes one explicit authenticated request
 * 协作入口 / Collaborators: `createServer`, `'a'.repeat`, `String`, `server.address`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(JSON.parse(result.stdout), sample)`; `assert.deepEqual(calls, [{ method: 'GET', body: null }, { method: 'POST', body: { action: 'probe' } }])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('runtime CLI inspect only reads the sample while probe makes one explicit authenticated request', async () => {
  const calls: { method: string; body: unknown }[] = [], failures: string[] = [];
  const sample = { actual: {}, declared: {}, selected: {}, mismatches: [], job: null,
    probe: { state: 'unprobed', checkedAt: null, configVersion: null, bootId: null } };
  const server = createServer(/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: req; res。
   * 结果：返回分支计算值（`res.end(JSON.stringify([{ id: 'vm', name: 'runtime-fixture' }]))`），以 Promise 交付。
   * Result: Return the branch-computed value (`res.end(JSON.stringify([{ id: 'vm', name: 'runtime-fixture' }]))`) through a Promise.
   * 验证场景 / Scenario: runtime CLI inspect only reads the sample while probe makes one explicit authenticated request
   * 状态影响 / State effects: `data`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `assert.equal`, `'a'.repeat`, `res.writeHead`, `res.end`.
   * 检查边界 / Checked boundaries: `assert.equal(req.headers['x-sakura-token'], 'a'.repeat(64))`; `assert.equal(req.url, '/api/vms/vm/runtimes')`.
   */
  async (req, res) => {
    try {
      assert.equal(req.headers['x-sakura-token'], 'a'.repeat(64));
      let data = '';
      for await (const chunk of req) data += chunk;
      if (req.url === '/api/vms') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([{ id: 'vm', name: 'runtime-fixture' }]));
      }
      assert.equal(req.url, '/api/vms/vm/runtimes');
      calls.push({ method: req.method!, body: data ? JSON.parse(data) : null });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(sample));
    } catch (error) {
      failures.push(String(error)); res.writeHead(500); res.end(JSON.stringify({ error: 'fixture failed' }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = { ...process.env, SAKURA_TOKEN: 'a'.repeat(64), SAKURA_PORT: String((server.address() as { port: number }).port) };
    for (const action of ['inspect', 'probe']) {
      const result = await promisify(execFile)(process.execPath,
        [resolve('scripts/cli.mjs'), 'runtimes', 'runtime-fixture', action], { env, timeout: 10000, windowsHide: true });
      assert.deepEqual(JSON.parse(result.stdout), sample);
    }
    assert.deepEqual(calls, [{ method: 'GET', body: null }, { method: 'POST', body: { action: 'probe' } }]);
    assert.deepEqual(failures, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
