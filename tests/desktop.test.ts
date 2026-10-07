/**
 * 模块职责：回归验证模块，围绕 `desktop` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `desktop`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: desktop shutdown reports application cleanup failure, closes other bridges and retries the original service; desktop discovery reads the guest disk and does not connect before boot completes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer, createConnection, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { Desktops } from '../server/desktop.ts';
import { defaultDesktopPreferences, parseDesktopPreferencesFile } from '../server/desktop-preferences.ts';
import { desktopPreferencesProbe } from '../server/desktop-guest.ts';
import type { Machines } from '../server/machines.ts';

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `machines, live, desktops`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, live, desktops`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `Object.assign`.
 */
function fixture() {
  const live = { status: 'running', startedAt: 'first-boot' };
  const machines = Object.assign(new EventEmitter(), {
    closing: false,
    live: new Map([['vm', live]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ memoryMiB: 2048 })`）。
     * Result: Return the branch-computed value (`({ memoryMiB: 2048 })`).
     */
    get: () => ({ memoryMiB: 2048 }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`live.status`）。
     * Result: Return the branch-computed value (`live.status`).
     */
    state: () => live.status,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ stdout: 'not-installed\n', stderr: '', code: 0 })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ stdout: 'not-installed\n', stderr: '', code: 0 })`) through a Promise.
     */
    exec: async () => ({ stdout: 'not-installed\n', stderr: '', code: 0 }),
  }) as unknown as Machines;
  return { machines, live, desktops: new Desktops(machines) };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: desktop shutdown reports application cleanup failure, closes other bridges and retries the original service
 * 状态影响 / State effects: `desktops.apps.close`, `desktops.clipboard.close`, `desktops.waylandClipboard.close`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `desktops.apps.close.bind`, `desktops.clipboard.close.bind`, `desktops.waylandClipboard.close.bind`.
 * 检查边界 / Checked boundaries: `assert.rejects(desktops.close(), error => error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === clea…`; `assert.equal(appAttempts, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('desktop shutdown reports application cleanup failure, closes other bridges and retries the original service', async () => {
  const { desktops } = fixture();
  const originalAppClose = desktops.apps.close.bind(desktops.apps);
  const originalX11Close = desktops.clipboard.close.bind(desktops.clipboard);
  const originalWaylandClose = desktops.waylandClipboard.close.bind(desktops.waylandClipboard);
  const cleanupError = new Error('original application cgroup cleanup unconfirmed');
  let appAttempts = 0, x11Attempts = 0, waylandAttempts = 0;
  desktops.apps.close = /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: desktop shutdown reports application cleanup failure, closes other bridges and retries the original service
   * 失败 / Failure: `cleanupError`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `originalAppClose`.
   */
  async () => {
    if (++appAttempts === 1) throw cleanupError;
    await originalAppClose();
  };
  desktops.clipboard.close = /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: desktop shutdown reports application cleanup failure, closes other bridges and retries the original service
   * 协作入口 / Collaborators: `originalX11Close`.
   */
  async () => { x11Attempts++; await originalX11Close(); };
  desktops.waylandClipboard.close = /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: desktop shutdown reports application cleanup failure, closes other bridges and retries the original service
   * 协作入口 / Collaborators: `originalWaylandClose`.
   */
  async () => { waylandAttempts++; await originalWaylandClose(); };
  try {
    await assert.rejects(desktops.close(), error => error instanceof AggregateError &&
      error.errors.length === 1 && error.errors[0] === cleanupError);
    assert.equal(appAttempts, 1); assert.equal(x11Attempts, 1); assert.equal(waylandAttempts, 1);
    await desktops.close();
    assert.equal(appAttempts, 2); assert.equal(x11Attempts, 2); assert.equal(waylandAttempts, 2);
  } finally { await originalAppClose(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: desktop discovery reads the guest disk and does not connect before boot completes
 * 状态影响 / State effects: `live.status`, `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `desktops.view`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.equal((await desktops.view('vm')).status, 'unavailable')`; `assert.throws(() => desktops.start('vm', 'install'), /启动完成/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('desktop discovery reads the guest disk and does not connect before boot completes', async () => {
  const { desktops, machines, live } = fixture();
  live.status = 'starting';
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: desktop discovery reads the guest disk and does not connect before boot completes
   * 失败 / Failure: `new Error('must not connect')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => {
    throw new Error('must not connect');
  };
  assert.equal((await desktops.view('vm')).status, 'unavailable');
  assert.throws(() => desktops.start('vm', 'install'), /启动完成/);
  live.status = 'running';
  for (const status of ['not-installed', 'starting', 'ready', 'stopped']) {
    machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ stdout: `${status}\n`, stderr: '', code: 0 })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ stdout: `${status}\n`, stderr: '', code: 0 })`) through a Promise.
     * 验证场景 / Scenario: desktop discovery reads the guest disk and does not connect before boot completes
     */
    async () => ({ stdout: `${status}\n`, stderr: '', code: 0 });
    assert.equal((await desktops.view('vm')).status, status);
  }
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ stdout: 'unexpected', stderr: '', code: 0 })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ stdout: 'unexpected', stderr: '', code: 0 })`) through a Promise.
   * 验证场景 / Scenario: desktop discovery reads the guest disk and does not connect before boot completes
   */
  async () => ({ stdout: 'unexpected', stderr: '', code: 0 });
  await assert.rejects(desktops.view('vm'), /检查桌面状态/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: desktop discovery restores persisted preferences and tolerates one bad field
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `desktops.view`, `assert.deepEqual`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(view.preferences, { ...defaultDesktopPreferences, resolution: '1920x1080', theme: 'midnight', wallpaper: 'midnigh…`; `assert.equal(parseDesktopPreferencesFile("THEME='paper'\nBROKEN='ignored'\n").theme, 'paper')`.
 */
test('desktop discovery restores persisted preferences and tolerates one bad field', async () => {
  const { desktops, machines } = fixture();
  let probe = true;
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
   * 验证场景 / Scenario: desktop discovery restores persisted preferences and tolerates one bad field
   * 状态影响 / State effects: `probe`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.equal(command, desktopPreferencesProbe)`.
   */
  async (_id, command) => {
    if (probe) {
      probe = false;
      return { stdout: 'ready\n', stderr: '', code: 0 };
    }
    assert.equal(command, desktopPreferencesProbe);
    return {
      stdout:
        "RESOLUTION='1920x1080'\nSCALE='not-a-number'\nTHEME='midnight'\nWALLPAPER='midnight'\nACCENT='#e6a6cb'\nPANEL='top'\nAUTO_HIDE_PANEL='true'\nANIMATIONS='false'\n",
      stderr: '',
      code: 0,
    };
  };
  const view = await desktops.view('vm');
  assert.deepEqual(view.preferences, {
    ...defaultDesktopPreferences,
    resolution: '1920x1080',
    theme: 'midnight',
    wallpaper: 'midnight',
    accent: '#e6a6cb',
    panel: 'top',
    autoHidePanel: true,
    animations: false,
  });
  assert.equal(parseDesktopPreferencesFile("THEME='paper'\nBROKEN='ignored'\n").theme, 'paper');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: configure operations carry the full preference set into the guest restart
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `desktops.start`, `assert.deepEqual`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(view.preferences, preferences)`; `assert.match(command, /SESSION_TYPE='wayland'/)`.
 */
test('configure operations carry the full preference set into the guest restart', async () => {
  const { desktops, machines } = fixture();
  const preferences = {
    sessionType: 'wayland' as const,
    resolution: '1600x1000' as const,
    monitorLayout: 'dual-horizontal' as const,
    scale: 150,
    theme: 'paper' as const,
    wallpaper: 'plain' as const,
    accent: '#6d7fb3',
    panel: 'floating' as const,
    autoHidePanel: true,
    animations: false,
  };
  let command = '';
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; value。
   * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
   * 验证场景 / Scenario: configure operations carry the full preference set into the guest restart
   * 状态影响 / State effects: `command`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  async (_id, value) => {
    command = value;
    return { stdout: '', stderr: '', code: 0 };
  };
  const view = desktops.start('vm', 'configure', preferences);
  assert.deepEqual(view.preferences, preferences);
  assert.match(command, /SESSION_TYPE='wayland'/);
  assert.match(command, /RESOLUTION='1600x1000'/);
  assert.match(command, /MONITOR_LAYOUT='dual-horizontal'/);
  assert.match(command, /WALLPAPER='plain'/);
  assert.match(command, /PANEL='floating'/);
  assert.match(command, /AUTO_HIDE_PANEL='true'/);
  assert.match(command, /ANIMATIONS='false'/);
  await delay(0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: starting a stopped desktop reapplies requested preferences before reconnecting
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `desktops.start`, `assert.match`, `delay`.
 * 检查边界 / Checked boundaries: `assert.match(command, /THEME='midnight'/)`; `assert.match(command, /WALLPAPER='midnight'/)`.
 */
test('starting a stopped desktop reapplies requested preferences before reconnecting', async () => {
  const { desktops, machines } = fixture();
  const preferences = { theme: 'midnight' as const, wallpaper: 'midnight' as const, panel: 'top' as const };
  let command = '';
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; value。
   * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
   * 验证场景 / Scenario: starting a stopped desktop reapplies requested preferences before reconnecting
   * 状态影响 / State effects: `command`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  async (_id, value) => {
    command = value;
    return { stdout: '', stderr: '', code: 0 };
  };
  desktops.start('vm', 'start', preferences);
  assert.match(command, /THEME='midnight'/);
  assert.match(command, /WALLPAPER='midnight'/);
  assert.match(command, /PANEL='top'/);
  await delay(0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: installation enforces memory, deduplicates concurrent requests, and makes failures retryable
 * 状态影响 / State effects: `machines.get`, `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.throws`, `desktops.start`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.throws(() => desktops.start('vm', 'install'), /1024 MiB/)`; `assert.equal(calls, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('installation enforces memory, deduplicates concurrent requests, and makes failures retryable', async () => {
  const { desktops, machines } = fixture();
  machines.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ memoryMiB: 512 }) as ReturnType<Machines['get']>`）。
   * Result: Return the branch-computed value (`({ memoryMiB: 512 }) as ReturnType<Machines['get']>`).
   * 验证场景 / Scenario: installation enforces memory, deduplicates concurrent requests, and makes failures retryable
   */
  () => ({ memoryMiB: 512 }) as ReturnType<Machines['get']>;
  assert.throws(() => desktops.start('vm', 'install'), /1024 MiB/);
  machines.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ memoryMiB: 2048 }) as ReturnType<Machines['get']>`）。
   * Result: Return the branch-computed value (`({ memoryMiB: 2048 }) as ReturnType<Machines['get']>`).
   * 验证场景 / Scenario: installation enforces memory, deduplicates concurrent requests, and makes failures retryable
   */
  () => ({ memoryMiB: 2048 }) as ReturnType<Machines['get']>;
  let calls = 0;
  let complete!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: value: Awaited<ReturnType<Machines['exec']>>。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (value: Awaited<ReturnType<Machines['exec']>>) => void;
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; _script; _timeout; _signal; output。
   * 结果：返回分支计算值（`new Promise((resolve) => { complete = resolve; })`），以 Promise 交付。
   * Result: Return the branch-computed value (`new Promise((resolve) => { complete = resolve; })`) through a Promise.
   * 验证场景 / Scenario: installation enforces memory, deduplicates concurrent requests, and makes failures retryable
   * 协作入口 / Collaborators: `output`, `'x'.repeat`.
   */
  async (_id, _script, _timeout, _signal, output) => {
    calls++;
    output?.('x'.repeat(20000));
    return new Promise((resolve) => {
      complete = resolve;
    });
  };
  desktops.start('vm', 'install');
  desktops.start('vm', 'start');
  assert.equal(calls, 1);
  assert.equal((await desktops.view('vm')).log.length, 16384);
  complete({ stdout: '', stderr: 'repository unavailable', code: 1 });
  await delay(0);
  assert.equal((await desktops.view('vm')).status, 'error');
  assert.equal((await desktops.view('vm')).error, 'repository unavailable');
  desktops.start('vm', 'install');
  assert.equal(calls, 2);
  complete({ stdout: '', stderr: '', code: 0 });
  await delay(0);
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ stdout: 'ready\n', stderr: '', code: 0 })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ stdout: 'ready\n', stderr: '', code: 0 })`) through a Promise.
   * 验证场景 / Scenario: installation enforces memory, deduplicates concurrent requests, and makes failures retryable
   */
  async () => ({ stdout: 'ready\n', stderr: '', code: 0 });
  assert.equal((await desktops.view('vm')).status, 'ready');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stopping cancels installation and stale completions cannot overwrite a new boot
 * 状态影响 / State effects: `machines.exec`, `live.status`, `live.startedAt`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `desktops.start`, `machines.emit`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(installationSignal?.aborted, true)`; `assert.equal((await desktops.view('vm')).status, 'not-installed')`.
 */
test('stopping cancels installation and stale completions cannot overwrite a new boot', async () => {
  const { desktops, machines, live } = fixture();
  let installationSignal: AbortSignal | undefined;
  let fail!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: error: Error。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error: Error) => void;
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; _command; _timeout; signal。
   * 结果：返回分支计算值（`new Promise((_resolve, reject) => { fail = reject; })`），以 Promise 交付。
   * Result: Return the branch-computed value (`new Promise((_resolve, reject) => { fail = reject; })`) through a Promise.
   * 验证场景 / Scenario: stopping cancels installation and stale completions cannot overwrite a new boot
   * 状态影响 / State effects: `installationSignal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  async (_id, _command, _timeout, signal) => {
    installationSignal = signal;
    return new Promise((_resolve, reject) => {
      fail = reject;
    });
  };
  desktops.start('vm', 'install');
  live.status = 'stopping';
  machines.emit('change');
  assert.equal(installationSignal?.aborted, true);
  live.status = 'running';
  live.startedAt = 'second-boot';
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ stdout: 'not-installed\n', stderr: '', code: 0 })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ stdout: 'not-installed\n', stderr: '', code: 0 })`) through a Promise.
   * 验证场景 / Scenario: stopping cancels installation and stale completions cannot overwrite a new boot
   */
  async () => ({ stdout: 'not-installed\n', stderr: '', code: 0 });
  fail(new Error('old operation failed'));
  await delay(0);
  assert.equal((await desktops.view('vm')).status, 'not-installed');
});

for (const loss of ['browser', 'SSH then VNC', 'VNC then SSH']) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `machines.connect`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `createServer`, `tcp.listen`, `once`, `createHttpServer`.
   * 检查边界 / Checked boundaries: `assert.equal(binary, true)`; `assert.equal(banner.toString(), 'RFB 003.008\n')`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test(`desktop bridge preserves binary data and releases the tunnel on ${loss} loss`, async (t) => {
    const tcpSockets = new Set<Socket>();
    const tcp = createServer((socket) => {
      tcpSockets.add(socket);
      socket.on('close', () => tcpSockets.delete(socket));
      socket.on('error', () => {});
      socket.write('RFB 003.008\n');
      socket.pipe(socket);
    });
    tcp.listen(0, '127.0.0.1');
    await once(tcp, 'listening');
    const http = createHttpServer();
    const wss = new WebSocketServer({ server: http });
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    t.after(async () => {
      for (const socket of wss.clients) socket.terminate();
      for (const socket of tcpSockets) socket.destroy();
      wss.close();
      await Promise.all([
        new Promise<void>((resolve) => http.close(() => resolve())),
        new Promise<void>((resolve) => tcp.close(() => resolve())),
      ]);
    });
    const { machines, desktops } = fixture();
    let destroyed = false;
    let channel: Socket;
    let ssh: EventEmitter;
    let connections = 0;
    machines.connect = /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`Object.assign((ssh = new EventEmitter()), { destroy: () => { destroyed = true; c…`），以 Promise 交付。
     * Result: Return the branch-computed value (`Object.assign((ssh = new EventEmitter()), { destroy: () => { destroyed = true; c…`) through a Promise.
     * 状态影响 / State effects: `ssh`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `Object.assign`.
     */
    async () =>
      Object.assign((ssh = new EventEmitter()), {
        /**
         * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
         * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 状态影响 / State effects: `destroyed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
         * 协作入口 / Collaborators: `channel?.destroy`.
         */
        destroy: () => {
          destroyed = true;
          channel?.destroy();
        },
        /**
         * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
         * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
         * 输入 / Inputs: command: string; callback: Function。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 状态影响 / State effects: `channel`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
         * 协作入口 / Collaborators: `assert.equal`, `createConnection`, `tcp.address`, `channel.once`.
         * 检查边界 / Checked boundaries: `assert.equal(command, 'exec nc 127.0.0.1 5901')`.
         */
        exec: (command: string, callback: Function) => {
          connections++;
          assert.equal(command, 'exec nc 127.0.0.1 5901');
          channel = createConnection({ host: '127.0.0.1', port: (tcp.address() as { port: number }).port });
          channel.once('connect', () => callback(null, channel));
        },
      }) as unknown as Awaited<ReturnType<Machines['connect']>>;
    wss.on('connection', (socket) => {
      void desktops.attach('vm', socket).catch(() => socket.close());
    });
    const client = new WebSocket(`ws://127.0.0.1:${(http.address() as { port: number }).port}`);
    t.after(() => client.terminate());
    const [banner, binary] = await once(client, 'message');
    assert.equal(binary, true);
    assert.equal(banner.toString(), 'RFB 003.008\n');
    const reply = once(client, 'message');
    const payload = Buffer.from([0, 1, 128, 255, 0, 37]);
    client.send(payload);
    assert.deepEqual((await reply)[0], payload);
    const closed = once(client, 'close');
    if (loss === 'browser') client.close();
    else if (loss === 'SSH then VNC') {
      ssh!.emit('close');
      channel!.destroy();
    } else {
      channel!.destroy();
      ssh!.emit('close');
    }
    await closed;
    await delay(10);
    assert.equal(destroyed, true);
    const recovered = new WebSocket(`ws://127.0.0.1:${(http.address() as { port: number }).port}`);
    t.after(() => recovered.terminate());
    assert.equal((await once(recovered, 'message'))[0].toString(), 'RFB 003.008\n');
    assert.equal(connections, 2, 'reconnection opens a fresh tunnel to the same guest service');
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: shared desktop bridge forwards framebuffer requests but closes on keyboard input
 * 状态影响 / State effects: `machines.connect`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Buffer.alloc`, `createServer`, `tcp.listen`, `once`.
 * 检查边界 / Checked boundaries: `assert.equal((await once(client, 'message'))[0].toString(), 'RFB 003.008\n')`; `assert.deepEqual(received, allowed)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('shared desktop bridge forwards framebuffer requests but closes on keyboard input', async (t) => {
  const tcpSockets = new Set<Socket>();
  let received = Buffer.alloc(0);
  const tcp = createServer((socket) => {
    tcpSockets.add(socket);
    socket.on('close', () => tcpSockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', (chunk: Buffer) => { received = Buffer.concat([received, chunk]); });
    socket.write('RFB 003.008\n');
  });
  tcp.listen(0, '127.0.0.1');
  await once(tcp, 'listening');
  const http = createHttpServer();
  const wss = new WebSocketServer({ server: http });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const { machines, desktops } = fixture();
  let channel: Socket;
  machines.connect = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`Object.assign(new EventEmitter(), { destroy: () => channel?.destroy(), exec: (_c…`），以 Promise 交付。
   * Result: Return the branch-computed value (`Object.assign(new EventEmitter(), { destroy: () => channel?.destroy(), exec: (_c…`) through a Promise.
   * 验证场景 / Scenario: shared desktop bridge forwards framebuffer requests but closes on keyboard input
   * 协作入口 / Collaborators: `Object.assign`.
   */
  async () => Object.assign(new EventEmitter(), {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`channel?.destroy()`）。
     * Result: Return the branch-computed value (`channel?.destroy()`).
     * 验证场景 / Scenario: shared desktop bridge forwards framebuffer requests but closes on keyboard input
     * 协作入口 / Collaborators: `channel?.destroy`.
     */
    destroy: () => channel?.destroy(),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _command: string; callback: Function。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: shared desktop bridge forwards framebuffer requests but closes on keyboard input
     * 状态影响 / State effects: `channel`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `createConnection`, `tcp.address`, `channel.once`.
     */
    exec: (_command: string, callback: Function) => {
      channel = createConnection({ host: '127.0.0.1', port: (tcp.address() as { port: number }).port });
      channel.once('connect', () => callback(null, channel));
    },
  }) as unknown as Awaited<ReturnType<Machines['connect']>>;
  wss.on('connection', (socket) => {
    void desktops.attach('vm', socket, true).catch(() => socket.close());
  });
  t.after(async () => {
    for (const socket of wss.clients) socket.terminate();
    for (const socket of tcpSockets) socket.destroy();
    wss.close();
    await desktops.close();
    await Promise.all([
      new Promise<void>((resolve) => http.close(() => resolve())),
      new Promise<void>((resolve) => tcp.close(() => resolve())),
    ]);
  });
  const client = new WebSocket(`ws://127.0.0.1:${(http.address() as { port: number }).port}`);
  t.after(() => client.terminate());
  assert.equal((await once(client, 'message'))[0].toString(), 'RFB 003.008\n');
  const allowed = Buffer.concat([
    Buffer.from('RFB 003.008\n'), Buffer.from([1, 1]),
    Buffer.from([3, 0, 0, 0, 0, 0, 0, 0, 64, 64]),
  ]);
  client.send(allowed.subarray(0, 7));
  client.send(allowed.subarray(7));
  for (let attempt = 0; attempt < 30 && received.length < allowed.length; attempt++) await delay(10);
  assert.deepEqual(received, allowed);
  const closed = once(client, 'close');
  client.send(Buffer.from([4, 1, 0, 0, 0, 0, 0, 65]));
  await closed;
  assert.deepEqual(received, allowed);
  for (const invalid of ['RFB 003.008\n', Buffer.alloc(65_537, 3)]) {
    const invalidClient = new WebSocket(`ws://127.0.0.1:${(http.address() as { port: number }).port}`);
    t.after(() => invalidClient.terminate());
    await once(invalidClient, 'message');
    const rejected = once(invalidClient, 'close');
    invalidClient.send(invalid);
    await rejected;
    assert.deepEqual(received, allowed, 'text and oversized frames must be rejected before forwarding any bytes');
  }
});
