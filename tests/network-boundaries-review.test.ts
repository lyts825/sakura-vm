/**
 * 模块职责：回归验证模块，围绕 `network-boundaries-review` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `network-boundaries-review`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: network guard rejects module loaders, reexports and aliased socket constructors; network guard follows lexical fetch references without file-wide exemptions.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { networkBoundaryErrors } from '../scripts/network-boundaries.ts';

/**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: code: string; file = 'server/example.ts'。
 * 结果：返回分支计算值（`networkBoundaryErrors(file, ts.createSourceFile(file, code, ts.ScriptTarget.Late…`）。
 * Result: Return the branch-computed value (`networkBoundaryErrors(file, ts.createSourceFile(file, code, ts.ScriptTarget.Late…`).
 * 协作入口 / Collaborators: `networkBoundaryErrors`, `ts.createSourceFile`.
 */
const check = (code: string, file = 'server/example.ts') =>
  networkBoundaryErrors(file, ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network guard rejects module loaders, reexports and aliased socket constructors
 * 协作入口 / Collaborators: `assert.ok`, `check`.
 * 检查边界 / Checked boundaries: `assert.ok(check(code).length, code)`.
 */
test('network guard rejects module loaders, reexports and aliased socket constructors', () => {
  for (const code of [
    "import { request as send } from 'node:https'; send(url);",
    "export { connect } from 'net';",
    "import network = require('node:net');",
    'await import(`node:https`);',
    "require('node:' + 'net');",
    "module.require('http');",
    "process.getBuiltinModule('net');",
    "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load('node:net');",
    "import WS from 'ws'; new WS(url);",
    "import { WebSocket as WS } from 'ws'; const Transport = WS; new Transport(url);",
    "import * as sockets from 'ws'; new sockets.WebSocket(url);",
    "export { WebSocket as Outgoing } from 'ws';",
    "import { TLSSocket as TLS } from 'node:tls'; new TLS(stream);",
    "import { Client as SSH } from 'ssh2'; new SSH();",
    "import { WebSocketServer as Listener } from 'ws'; new Listener({port: 8080});",
    'const { WebSocket: WS } = globalThis; new WS(url);',
  ])
    assert.ok(check(code).length, code);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network guard follows lexical fetch references without file-wide exemptions
 * 协作入口 / Collaborators: `assert.ok`, `check`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.ok(check(code).length, code)`; `assert.deepEqual(check(code), [], code)`.
 */
test('network guard follows lexical fetch references without file-wide exemptions', () => {
  for (const code of [
    'const send = fetch; send(url);',
    'const context = { fetch };',
    'function local(fetch) { fetch(url); } fetch(url);',
    'function local() { const { fetch } = networkFor("owner"); } fetch(url);',
    'const { fetch: send } = globalThis;',
    'const ambient = globalThis; ambient["f" + "etch"](url);',
    'global.fetch(url);',
    'const source = new EventSource(url);',
  ])
    assert.ok(check(code).length, code);
  for (const code of [
    'const { fetch } = networkFor("owner"); const send = fetch; send(url);',
    'function local(fetch: typeof globalThis.fetch) { return fetch(url); }',
    'const options = { fetch: managedFetch }; options.fetch(url);',
    "import type { Socket } from 'node:net'; export { type Server } from 'node:http';",
    "import { isIP } from 'node:net'; import { createSecureContext, TLSSocket } from 'node:tls'; isIP(host); socket instanceof TLSSocket;",
    "import { WebSocket, WebSocketServer } from 'ws'; const state = WebSocket.OPEN; new WebSocketServer({ noServer: true });",
  ])
    assert.deepEqual(check(code), [], code);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network guard requires managed S3 transports and explicit credentials under aliases
 * 协作入口 / Collaborators: `assert.ok`, `check`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.ok(check(prefix + `new Store(${options});`).length, options)`; `assert.deepEqual( check(prefix + 'new Store({requestHandler: scope.requestHandler(), credentials: value});'), [], )`.
 */
test('network guard requires managed S3 transports and explicit credentials under aliases', () => {
  const prefix = "import { S3Client as Store } from '@aws-sdk/client-s3'; ";
  for (const options of [
    '{}',
    '{requestHandler: undefined, credentials: value}',
    '{requestHandler: scope.requestHandler()}',
    '{requestHandler: scope.requestHandler(), credentials: undefined}',
  ])
    assert.ok(check(prefix + `new Store(${options});`).length, options);
  assert.deepEqual(
    check(prefix + 'new Store({requestHandler: scope.requestHandler(), credentials: value});'),
    [],
  );
  assert.deepEqual(check(prefix + 'new Store({requestHandler: scope.requestHandler(), credentials});'), []);
  assert.deepEqual(
    check(
      prefix + 'const requestHandler = scope.requestHandler(); new Store({requestHandler, credentials});',
    ),
    [],
  );
  assert.deepEqual(check("import { createConnection } from 'node:net';", 'server/network/host-pool.ts'), []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: architecture gate checks lazy plugin helpers and all packaged script dependencies
 * 状态影响 / State effects: `result`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.notEqual(result.status, 0)`; `assert.match(result.stderr, /plugins\/example\/helper.mjs.*Unmanaged/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('architecture gate checks lazy plugin helpers and all packaged script dependencies', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-network-boundaries-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  });
  for (const folder of ['server', 'src', 'shared', 'plugins/example', 'scripts'])
    await mkdir(join(root, folder), { recursive: true });
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: file: string; code: string。
   * 结果：返回分支计算值（`writeFile(join(root, file), code)`）。
   * Result: Return the branch-computed value (`writeFile(join(root, file), code)`).
   * 验证场景 / Scenario: architecture gate checks lazy plugin helpers and all packaged script dependencies
   * 协作入口 / Collaborators: `writeFile`, `join`.
   */
  const write = (file: string, code: string) => writeFile(join(root, file), code);
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`spawnSync( process.execPath, ['--import', import.meta.resolve('tsx'), resolve('s…`）。
   * Result: Return the branch-computed value (`spawnSync( process.execPath, ['--import', import.meta.resolve('tsx'), resolve('s…`).
   * 验证场景 / Scenario: architecture gate checks lazy plugin helpers and all packaged script dependencies
   * 协作入口 / Collaborators: `spawnSync`, `import.meta.resolve`, `resolve`.
   */
  const run = () =>
    spawnSync(
      process.execPath,
      ['--import', import.meta.resolve('tsx'), resolve('scripts/check-architecture.ts')],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000 },
    );
  await write('plugins/example/server.ts', 'export const load = () => import("./helper.mjs");');
  await write('plugins/example/helper.mjs', 'export const send = fetch;');
  let result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /plugins\/example\/helper.mjs.*Unmanaged/);
  await write('plugins/example/helper.mjs', 'export const safe = true;');
  await write('scripts/package-release.mjs', "for (const file of ['custom-runtime.mjs']) copy(file);");
  await write('scripts/custom-runtime.mjs', "import './runtime-helper.mjs';");
  await write('scripts/runtime-helper.mjs', "import https from 'node:https';");
  result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /scripts\/runtime-helper.mjs.*Direct network/);
  await write('scripts/runtime-helper.mjs', 'export const safe = true;');
  result = run();
  assert.equal(result.status, 0, result.stderr);
});
