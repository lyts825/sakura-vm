/**
 * 模块职责：在自有私有 window station 核对真实 Windows 剪贴板方向、格式、敏感扫描与启动取消。
 * Module: Verify real Windows clipboard directions, formats, sensitive scanning and launch cancellation on an owned private window station.
 * 设计思路：编译并驱动自有夹具，在私有 station、独立状态文件与精确出生身份范围内检查实际回执；本脚本会产生临时进程/资产，执行平台及编译器要求由入口校验定义。
 * Design: Compile/drive owned fixtures and check actual receipts within private stations, separate state files and exact process-birth identities. This script creates temporary processes/assets; entry checks define platform/compiler requirements.
 */
import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, copyFile, cp, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { NativeClipboard } from '../server/native-clipboard.ts';

if (process.platform !== 'win32') throw new Error('The native clipboard smoke requires Windows.');
const execute = promisify(execFile);
const bits = Number(process.argv[2] || '64');
assert.ok(bits === 64 || bits === 32, 'Specify 64 or 32 for the fixture architecture');
const folder = resolve('.data/native-clipboard-test-temp/fixture-' + randomUUID());
await mkdir(folder, { recursive: true });
const compiler32 = resolve('.tools/mingw32-16.2.0/mingw32/bin/g++.exe');
const compiler =
  bits === 32
    ? process.env.SAKURA_NATIVE_CLIPBOARD_CXX32 ||
      (existsSync(compiler32) ? compiler32 : 'i686-w64-mingw32-g++.exe')
    : process.env.SAKURA_NATIVE_CLIPBOARD_CXX || 'g++.exe';
const fixture = join(folder, 'fixture.exe'),
  other = join(folder, 'other.exe');
/**
 * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
 * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
 * 输入 / Inputs: target。
 * 结果：返回列表形式的受控数据，供调用者遍历或比较。
 * Result: Return controlled data as a list for iteration or comparison.
 * 协作入口 / Collaborators: `resolve`.
 */
const fixtureArguments = (target) => [
  '-std=c++17',
  '-O2',
  '-s',
  '-static',
  '-municode',
  resolve('native/windows-clipboard/fixture.cpp'),
  '-o',
  target,
  '-lole32',
  '-luuid',
  '-lshell32',
  '-ladvapi32',
];
await execute(compiler, fixtureArguments(fixture), { windowsHide: true, timeout: 60000 });
if (bits === 32)
  await execute(process.env.SAKURA_NATIVE_CLIPBOARD_CXX || 'g++.exe', fixtureArguments(other), {
    windowsHide: true,
    timeout: 60000,
  });
else await copyFile(fixture, other);
const assets = resolve(process.env.SAKURA_NATIVE_CLIPBOARD_ASSETS || '.tools/native-clipboard');
const controller = join(assets, `sakura-clipboard-controller${bits === 32 ? '-x86' : ''}.exe`);
const library = join(assets, `SakuraClipboardPolicy${bits === 32 ? '-x86' : ''}.dll`);
const owner = randomUUID();
/**
 * 中文功能：启动直接夹具或准备受控启动管道，统一提供 ready、命令请求和关闭接口。
 * English: Start a direct fixture or prepare a controlled-launch pipe, exposing one ready/request/close interface.
 * 输入 / Inputs: path; station; controlled。
 * 结果：返回受控对象，公开字段包括 `child, path, ready, committed, request, close`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `child, path, ready, committed, request, close`; the actual branch determines its shape.
 * 状态影响 / State effects: `pipe`, `server`, `args`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `createServer`, `spawn`, `receive`.
 * 设计思路：将管道准备与控制面提交分开，ready 的拒绝先登记观察以避免未处理拒绝；等待者各自有超时，退出拒绝尚未完成的请求，close 回收本入口创建的流与服务。
 * Design: Separate pipe preparation from control-plane commitment and observe ready rejection immediately. Waiters have individual deadlines, exits reject pending requests, and close releases streams/servers created by this entry.
 */
async function launch(path, station, controlled) {
  let server, socket, lines, pipe;
  const queued = [],
    waiting = [];
  let error = '',
    closed = false,
    phase = 'startup';
  /**
   * 中文功能：把给定流连接到逐行 JSON 读取器，按等待者或排队状态分发夹具消息。
   * English: Attach the given stream to a line-delimited JSON reader and dispatch fixture messages to waiters or the queue.
   * 输入 / Inputs: input。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `lines`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `createInterface`, `lines.on`.
   */
  const receive = (input) => {
    lines = createInterface({ input });
    lines.on('line', (line) => {
      const message = JSON.parse(line);
      if (waiting.length) waiting.shift().resolve(message);
      else queued.push(message);
    });
  };
  let args = [station];
  if (station === '--create' || controlled) {
    pipe = '\\\\.\\pipe\\SakuraClipboardTest.' + randomUUID();
    server = createServer((connection) => {
      if (socket) {
        connection.destroy();
        return;
      }
      socket = connection;
      socket.on('close', () => {
        closed = true;
      });
      receive(socket);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipe, resolve);
    });
    args = ['--launch', pipe];
  }
  const child = controlled
    ? undefined
    : spawn(path, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  if (!server) receive(child.stdout);
  child?.stderr.on('data', (chunk) => {
    error += chunk;
  });
  child?.on('exit', (code) => {
    closed = true;
    for (const wait of waiting.splice(0)) wait.reject(new Error(`fixture closed ${code}: ${error}`));
  });
  child?.on('error', (error) => {
    for (const wait of waiting.splice(0)) wait.reject(error);
  });
  /**
   * 中文功能：优先取已排队回执，否则登记等待者；关闭或超时通过本分支的拒绝路径结束等待。
   * English: Consume a queued receipt first or register a waiter; the implemented closure/timeout rejection path ends pending waits.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`queued.length ? Promise.resolve(queued.shift()) : closed ? Promise.reject(new Er…`）。
   * Result: Return the branch-computed value (`queued.length ? Promise.resolve(queued.shift()) : closed ? Promise.reject(new Er…`).
   * 协作入口 / Collaborators: `Promise.resolve`, `queued.shift`, `Promise.reject`.
   */
  const next = () =>
    queued.length
      ? Promise.resolve(queued.shift())
      : closed
        ? Promise.reject(new Error('fixture closed'))
        : new Promise(/**
         * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
         * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
         * 输入 / Inputs: resolve; reject。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 协作入口 / Collaborators: `setTimeout`, `waiting.push`.
         */
        (resolve, reject) => {
            const waiter = {
              /**
               * 中文功能：清除本等待者的超时定时器并完成其成功结果。
               * English: Clear this waiter's timeout and settle its successful result.
               * 输入 / Inputs: result。
               * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
               * Result: No explicit result value; callers observe completion, state changes or an exception.
               * 协作入口 / Collaborators: `clearTimeout`, `resolve`.
               */
              resolve: (result) => {
                clearTimeout(timer);
                resolve(result);
              },
              /**
               * 中文功能：清除本等待者的超时定时器并交付失败原因。
               * English: Clear this waiter's timeout and deliver its rejection reason.
               * 输入 / Inputs: reason。
               * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
               * Result: No explicit result value; callers observe completion, state changes or an exception.
               * 协作入口 / Collaborators: `clearTimeout`, `reject`.
               */
              reject: (reason) => {
                clearTimeout(timer);
                reject(reason);
              },
            };
            const timer = setTimeout(() => {
              const index = waiting.indexOf(waiter);
              if (index >= 0) waiting.splice(index, 1);
              reject(new Error(`fixture response timeout (${phase})`));
            }, 40000);
            waiting.push(waiter);
          });
  const ready = next();
  void ready.catch(() => {});
  return {
    child,
    path,
    ready,
    committed: controlled?.(pipe),
    /**
     * 中文功能：向夹具发送操作与可选正文，再等待与本命令对应的下一条回执。
     * English: Send an operation and optional body to the fixture, then await the next receipt for this command.
     * 输入 / Inputs: action; text。
     * 结果：返回分支计算值（`next()`），以 Promise 交付。
     * Result: Return the branch-computed value (`next()`) through a Promise.
     * 状态影响 / State effects: `phase`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `(socket || child.stdin).write`, `next`.
     */
    request: async (action, text) => {
      phase = action;
      (socket || child.stdin).write(action + (text === undefined ? '' : '\t' + text) + '\n');
      return next();
    },
    /**
     * 中文功能：关闭本夹具拥有的进程、流或管道；具体等待期限和强制终止条件以本函数分支为准。
     * English: Close processes, streams or pipes owned by this fixture; its branches define wait deadlines and forced-termination conditions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `(socket || child?.stdin)?.end`, `lines?.close`, `socket?.destroy`.
     */
    close: async () => {
      (socket || child?.stdin)?.end();
      if (child && !closed)
        await new Promise((resolve) => {
          child.once('exit', resolve);
          setTimeout(() => {
            if (!closed) child.kill();
            resolve();
          }, 5000).unref();
        });
      lines?.close();
      socket?.destroy();
      if (server) await new Promise((resolve) => server.close(resolve));
    },
  };
}
const a = await launch(fixture, '--create');
let identity, b, c, started, service;
/**
 * 中文功能：执行固定原生控制器命令，收集其输出并解析 JSON 状态供断言使用。
 * English: Execute a fixed native-controller command, collect output and parse JSON state for assertions.
 * 输入 / Inputs: args。
 * 结果：返回分支计算值（`JSON.parse(stdout)`），以 Promise 交付。
 * Result: Return the branch-computed value (`JSON.parse(stdout)`) through a Promise.
 * 失败 / Failure: `new Error(JSON.parse(error.stdout).error)`; `error`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `execute`, `JSON.parse`.
 */
async function agent(args) {
  try {
    const { stdout } = await execute(controller, args, { windowsHide: true, timeout: 70000 });
    return JSON.parse(stdout);
  } catch (error) {
    if (error.stdout) throw new Error(JSON.parse(error.stdout).error);
    throw error;
  }
}
/**
 * 中文功能：向指定原进程应用本用例的方向、大小和启用策略，核对操作回执与实际状态。
 * English: Apply this case's direction, size and enablement policy to the specified original process and check receipts/state.
 * 输入 / Inputs: flags; maximum = 1048576; active = true。
 * 结果：返回分支计算值（`state`），以 Promise 交付。
 * Result: Return the branch-computed value (`state`) through a Promise.
 * 协作入口 / Collaborators: `agent`, `String`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(state.ready, true)`; `assert.equal(state.active, active)`.
 */
async function apply(flags, maximum = 1048576, active = true) {
  const state = await agent([
    'apply',
    owner,
    String(identity.pid),
    identity.created,
    fixture,
    library,
    String(flags),
    String(maximum),
    active ? '1' : '0',
  ]);
  assert.equal(state.ready, true);
  assert.equal(state.active, active);
  return state;
}
/**
 * 中文功能：在 prepared 或 attached 边界注入输入 EOF、强制退出或提交回复丢失，验证新 Job 的清理与邻居保护。
 * English: Inject input EOF, forced exit or lost commit output at prepared/attached boundaries to verify fresh-Job cleanup and neighbor protection.
 * 输入 / Inputs: binding; stage; mode。
 * 结果：返回受控对象，公开字段包括 `stage, mode, process, stopped, primaryNeverEntered, replyLostAfterResume, mappingGone, existingFixtureRetained`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `stage, mode, process, stopped, primaryNeverEntered, replyLostAfterResume, mappingGone, existingFixtureRetained`; the actual branch determines its shape.
 * 状态影响 / State effects: `pipeServer`, `prepared`, `present`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `join`, `createServer`, `spawn`.
 * 检查边界 / Checked boundaries: `assert.equal(prepared.stage, 'prepared')`; `assert.equal(prepared.launchId, nonce)`.
 * 设计思路：记录新进程完整身份再破坏握手，仅在 stdout-loss 情景允许主线程可能已恢复；用原生清单检查该进程消失，并在 finally 回收本测试的管道和控制器，不用邻居消失推断清理成功。
 * Design: Capture the complete new process identity before breaking the handshake; only stdout-loss permits a possibly resumed primary thread. Check disappearance through native inventory, then finalize this case's pipes/controller without inferring success from a neighbor's fate.
 */
async function failedControlledLaunch(binding, stage, mode) {
  const failureOwner = randomUUID(),
    nonce = randomUUID();
  const marker = join(folder, `must-not-enter-${stage}-${mode}-${nonce}`);
  const privatePipe = '\\\\.\\pipe\\SakuraClipboardFailure.' + nonce;
  let pipeServer, pipeSocket;
  if (mode === 'stdout-loss') {
    pipeServer = createServer((connection) => {
      pipeSocket = connection;
      connection.resume();
    });
    await new Promise((resolve, reject) => {
      pipeServer.once('error', reject);
      pipeServer.listen(privatePipe, resolve);
    });
  }
  const child = spawn(
    controller,
    [
      'launch',
      failureOwner,
      fixture,
      binding.sha256,
      library,
      '4',
      '1048576',
      nonce,
      '--controlled',
      mode === 'stdout-loss' ? privatePipe : '\\\\.\\pipe\\SakuraClipboardMissing.' + nonce,
      identity.station,
      failureOwner,
      '--entry-marker',
      marker,
    ],
    { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const messages = [],
    waiting = [];
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    const value = JSON.parse(line);
    if (waiting.length) waiting.shift().resolve(value);
    else messages.push(value);
  });
  child.stderr.resume();
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const timer = setTimeout(() => child.kill(), 40000);
  /**
   * 中文功能：优先取已排队回执，否则登记等待者；关闭或超时通过本分支的拒绝路径结束等待。
   * English: Consume a queued receipt first or register a waiter; the implemented closure/timeout rejection path ends pending waits.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve, reje…`）。
   * Result: Return the branch-computed value (`messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve, reje…`).
   * 协作入口 / Collaborators: `Promise.resolve`, `messages.shift`.
   */
  const next = () =>
    messages.length
      ? Promise.resolve(messages.shift())
      : new Promise((resolve, reject) => {
          const item = { resolve, reject };
          waiting.push(item);
          exit.then(() => reject(new Error('failure fixture helper exited before handshake')));
        });
  let prepared;
  try {
    prepared = await next();
    assert.equal(prepared.stage, 'prepared');
    assert.equal(prepared.launchId, nonce);
    assert.equal(prepared.process.image.toLowerCase(), fixture.toLowerCase());
    assert.equal(prepared.process.bits, bits);
    assert.notEqual(prepared.process.pid, identity.pid);
    if (stage === 'attached') {
      child.stdin.write(`attach ${nonce}\n`);
      const attached = await next();
      assert.equal(attached.stage, 'attached');
      assert.deepEqual(attached.process, prepared.process);
      assert.equal(attached.state.ready, true);
      assert.equal(attached.state.active, true);
    }
    if (mode === 'stdout-loss') {
      // Break the commit reply pipe after attachment, then permit resume. A
      // publication failure must explicitly terminate this fresh Job even
      // though its kill-on-close flag was already cleared after resume.
      const outputClosed = new Promise((resolve) => child.stdout.once('close', resolve));
      child.stdout.destroy();
      await outputClosed;
      child.stdin.end(`resume ${nonce}\n`);
    } else if (mode === 'kill') child.kill();
    else child.stdin.end();
    const stopped = await exit;
    assert.ok(stopped.code !== 0 || stopped.signal, 'a rejected launch is never a committed success');
    let present = true;
    const deadline = Date.now() + 5000;
    while (present && Date.now() < deadline) {
      present = (await agent(['list'])).processes.some(
        (process) => process.pid === prepared.process.pid && process.created === prepared.process.created,
      );
      if (present) await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(present, false, 'the atomic Job cleans up its owned pending child when its helper exits');
    assert.deepEqual(
      await agent(['status', failureOwner, String(prepared.process.pid), prepared.process.created]),
      { present: false },
    );
    if (mode !== 'stdout-loss')
      assert.equal(
        existsSync(marker),
        false,
        'the primary thread never entered wmain on a rejected handshake',
      );
    assert.ok(
      (await agent(['list'])).processes.some(
        (process) => process.pid === identity.pid && process.created === identity.created,
      ),
      'an existing unrelated fixture is not terminated',
    );
    return {
      stage,
      mode,
      process: prepared.process,
      stopped,
      primaryNeverEntered: !existsSync(marker),
      replyLostAfterResume: mode === 'stdout-loss',
      mappingGone: true,
      existingFixtureRetained: true,
    };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    child.stdin.destroy();
    lines.close();
    child.stdout.destroy();
    child.stderr.destroy();
    await exit.catch(() => {});
    pipeSocket?.destroy();
    if (pipeServer) await new Promise((resolve) => pipeServer.close(resolve));
  }
}
/**
 * 中文功能：在新启动记录出现或策略附着后关闭服务，验证取消保留持久归属且原生新进程被终止。
 * English: Close the service after a new launch record appears or policy attaches, verifying retained durable ownership and termination of the new native process.
 * 输入 / Inputs: binding; file; stage。
 * 结果：返回受控对象，公开字段包括 `stage, process, primaryNeverEntered, ownershipRetained, otherPolicyRetained`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `stage, process, primaryNeverEntered, ownershipRetained, otherPolicyRetained`; the actual branch determines its shape.
 * 状态影响 / State effects: `cancelled`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `JSON.parse`, `readFile`, `saved.managed.map`, `join`.
 * 检查边界 / Checked boundaries: `assert.rejects( cancelled.action({ action: 'launch', version: cancelled.view().version, image: binding.image, sha256: binding.sha2…`; `assert.ok(owned)`.
 * 设计思路：从原记录集合区分新运行，guard 只触发一次 close；启动拒绝、关闭完成和入口标记分别观察，取消后的持久回执保留供重建核对，其他受限夹具仍必须存活。
 * Design: Distinguish the new run from the original record set and let guard trigger close once. Observe launch rejection, close completion and entry markers separately; retain post-cancel durable receipts for reconciliation while other restricted fixtures remain alive.
 */
async function closedServiceLaunch(binding, file, stage) {
  const saved = JSON.parse(await readFile(file, 'utf8'));
  const previous = new Set(saved.managed.map((process) => `${process.pid}:${process.created}`));
  const cancelFile = join(folder, `close-${stage}.json`);
  const marker = join(folder, `close-${stage}-must-not-enter`);
  await writeFile(cancelFile, JSON.stringify(saved));
  let cancelled, closeTask, owned;
  let closed;
  const closing = new Promise((resolve) => {
    closed = resolve;
  });
  cancelled = new NativeClipboard({
    file: cancelFile,
    assets,
    interval: 0,
    /**
     * 中文功能：检查本轮真实原生回执和状态，以下断言摘录给出本函数具体核对的边界。
     * English: Check real native receipts/state from this run; assertion excerpts below identify the boundaries checked by this function.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `owned`, `closeTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `JSON.parse`, `readFileSync`, `state.managed.find`, `spawnSync`.
     * 检查边界 / Checked boundaries: `assert.equal(checked.status, 0)`.
     */
    guard: () => {
      const state = JSON.parse(readFileSync(cancelFile, 'utf8'));
      const pending = state.managed.find((process) => !previous.has(`${process.pid}:${process.created}`));
      if (!pending || closeTask) return;
      if (stage === 'attached') {
        const checked = spawnSync(controller, ['status', state.owner, String(pending.pid), pending.created], {
          windowsHide: true,
          shell: false,
          encoding: 'utf8',
          timeout: 5000,
        });
        assert.equal(checked.status, 0);
        const native = JSON.parse(checked.stdout);
        if (!native.present || !native.ready || !native.active) return;
      }
      owned = pending;
      closeTask = cancelled.close();
      closed();
    },
  });
  try {
    await cancelled.init();
    const rejected = assert.rejects(
      cancelled.action({
        action: 'launch',
        version: cancelled.view().version,
        image: binding.image,
        sha256: binding.sha256,
        args: [
          '--controlled',
          '\\\\.\\pipe\\SakuraClipboardMissing.' + randomUUID(),
          identity.station,
          saved.owner,
          '--entry-marker',
          marker,
        ],
      }),
      /中止|关闭|复核/,
    );
    await closing;
    await closeTask;
    await rejected;
    assert.ok(owned);
    assert.ok(
      JSON.parse(await readFile(cancelFile, 'utf8')).managed.some(
        (process) => process.pid === owned.pid && process.created === owned.created,
      ),
      'service cancellation keeps the durably recorded ownership until it can be reconciled',
    );
    assert.equal(
      (await agent(['list'])).processes.some(
        (process) => process.pid === owned.pid && process.created === owned.created,
      ),
      false,
    );
    assert.equal(existsSync(marker), false);
    assert.equal((await a.request('write', 'other fixture remains restricted')).ok, false);
    return {
      stage,
      process: owned,
      primaryNeverEntered: true,
      ownershipRetained: true,
      otherPolicyRetained: true,
    };
  } finally {
    await cancelled.close();
  }
}
try {
  identity = await a.ready;
  assert.notEqual(identity.station.toLowerCase(), 'winsta0');
  b = await launch(other, identity.station);
  const counterpart = await b.ready;
  assert.equal(counterpart.station, identity.station);
  assert.ok(
    (await agent(['list'])).processes.some(
      (p) => p.pid === identity.pid && p.created === identity.created && p.bits === bits,
    ),
  );
  assert.equal((await b.request('write', 'baseline')).ok, true);
  assert.equal((await a.request('read')).text, 'baseline');
  await assert.rejects(
    agent([
      'apply',
      owner,
      String(identity.pid),
      String(BigInt(identity.created) - 1n),
      fixture,
      library,
      '7',
      '1048576',
      '1',
    ]),
    /identity changed/,
  );
  assert.deepEqual(await agent(['status', owner, String(identity.pid), identity.created]), {
    present: false,
  });
  await apply(6);
  assert.equal((await a.request('write', 'refused')).ok, false);
  assert.equal((await b.request('read')).text, 'baseline');
  assert.equal((await a.request('read')).text, 'baseline');
  await apply(5);
  assert.equal((await a.request('read')).ok, false);
  const metadata = await a.request('formats');
  assert.equal(metadata.count, 0);
  assert.equal(metadata.nativeCount, 0);
  assert.equal(metadata.available, false);
  assert.equal(metadata.priority, 0);
  assert.equal(metadata.filled, 0);
  assert.equal((await a.request('write', 'permitted')).ok, true);
  assert.equal((await b.request('read')).text, 'permitted');
  await apply(15, 1024);
  const secret = 'sk-' + randomUUID().replaceAll('-', '');
  assert.equal((await b.request('write', secret)).ok, true);
  assert.equal((await a.request('read')).ok, false);
  assert.equal((await a.request('write', secret)).ok, false);
  assert.equal((await a.request('write', '𠮷'.repeat(275))).ok, false);
  assert.equal((await a.request('malformed')).ok, false);
  assert.equal((await a.request('write', '中文 text')).ok, true);
  assert.equal((await b.request('read')).text, '中文 text');
  await apply(15, 1048576);
  assert.equal((await a.request('write', 'eyJ' + 'a'.repeat(65536))).ok, true);
  for (const content of [
    'api_key=' + 'a'.repeat(65536),
    'eyJ' + 'a'.repeat(65536) + '.abcdefgh.' + 'b'.repeat(65536),
    'https://user:' + 'c'.repeat(65536) + '@example.test',
  ]) {
    assert.equal((await b.request('write', content)).ok, true);
    assert.equal((await a.request('read')).ok, false);
    assert.equal((await a.request('write', content)).ok, false);
  }
  await apply(3);
  assert.equal((await b.request('write-binary')).ok, true);
  assert.equal((await a.request('read-binary')).ok, false);
  assert.equal((await a.request('write-binary')).ok, false);
  await apply(7);
  assert.equal((await a.request('write-binary')).ok, true);
  assert.equal((await b.request('read-binary')).ok, true);
  console.log(
    'Actual Win32 copy/paste, format enumeration, text limits, sensitive text and binary rules passed.',
  );
  assert.equal((await b.request('ole-copy', 'OLE baseline')).ok, true);
  assert.equal((await a.request('ole-read')).text, 'OLE baseline');
  assert.equal((await a.request('ole-read-here')).text, 'OLE baseline');
  assert.equal((await a.request('ole-cache')).ok, true);
  await apply(5);
  assert.equal((await a.request('ole-read')).ok, false);
  assert.equal((await a.request('ole-read-here')).ok, false);
  assert.equal((await a.request('ole-cached-read')).ok, false);
  assert.equal((await a.request('ole-copy', 'copy without paste')).ok, true);
  assert.equal((await b.request('ole-read')).text, 'copy without paste');
  assert.equal((await b.request('ole-copy', 'OLE baseline')).ok, true);
  await apply(7);
  assert.equal((await a.request('ole-cached-read')).text, 'OLE baseline');
  assert.equal((await a.request('ole-copy', 'OLE copied')).ok, true);
  assert.deepEqual(await b.request('ole-read'), { ok: true, error: 0, text: 'OLE copied' });
  await apply(6);
  assert.equal((await a.request('ole-copy', 'OLE refused')).ok, false);
  assert.equal((await a.request('ole-flush')).ok, false);
  // OLE keeps a live source object. Tightening copy also refuses bytes from
  // that already-declared object when another application requests them later.
  assert.equal((await b.request('ole-read')).ok, false);
  await apply(15, 1024);
  assert.equal((await b.request('ole-copy', secret)).ok, true);
  assert.equal((await a.request('ole-read')).ok, false);
  assert.equal((await a.request('ole-read-here')).ok, false);
  assert.equal((await a.request('ole-copy', 'permitted OLE text')).ok, true);
  assert.equal((await b.request('ole-read')).text, 'permitted OLE text');
  assert.equal((await a.request('ole-flush')).ok, true);
  assert.equal((await b.request('read')).text, 'permitted OLE text');
  await apply(3);
  assert.equal((await b.request('ole-copy', 'files disabled OLE text')).ok, true);
  assert.equal((await a.request('ole-read')).text, 'files disabled OLE text');
  assert.equal((await a.request('ole-copy', 'plain OLE source')).ok, true);
  assert.equal((await b.request('ole-read')).text, 'plain OLE source');
  assert.equal((await b.request('ole-copy-rich', 'external rich source')).ok, true);
  assert.equal((await a.request('ole-read')).text, 'external rich source');
  assert.equal((await a.request('ole-read-binary')).ok, false);
  assert.equal((await a.request('ole-copy-rich', 'filtered rich source')).ok, true);
  assert.equal((await b.request('ole-read')).text, 'filtered rich source');
  assert.equal((await b.request('ole-read-binary')).ok, false);
  await apply(7);
  assert.equal((await a.request('delayed', 'delayed text')).ok, true);
  assert.equal((await b.request('read')).text, 'delayed text');
  assert.equal((await a.request('delayed', 'late refusal')).ok, true);
  await apply(6);
  assert.equal((await b.request('read')).ok, false);
  const before = await agent(['status', owner, String(identity.pid), identity.created]);
  assert.ok(before.blockedCopy > 0 && before.blockedPaste > 0);
  await apply(0, 1024, false);
  assert.equal((await a.request('write', 'disabled native rule')).ok, true);
  assert.equal((await b.request('read')).text, 'disabled native rule');
  assert.equal((await a.request('ole-copy', 'disabled OLE rule')).ok, true);
  assert.equal((await b.request('ole-read')).text, 'disabled OLE rule');
  console.log(
    'Actual OLE proxies, cached proxy tightening, delayed rendering, explicit disable and refusal counters passed.',
  );
  const file = join(folder, 'native-service.json');
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: 1,
      version: 1,
      owner,
      settings: { enabled: false, applications: [] },
      managed: [],
    }),
  );
  let locked = false;
  const options = {
    file,
    assets,
    interval: 150,
    /**
     * 中文功能：计算本轮原生验收的辅助值；输入与分支结果如下，供相邻创建或断言步骤使用。
     * English: Compute a helper value for this native smoke; inputs and branch results below serve adjacent creation/assertion steps.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('session locked')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    guard: () => {
      if (locked) throw new Error('session locked');
    },
  };
  service = new NativeClipboard(options);
  await service.init();
  assert.equal(service.view().ready, true, service.view().error);
  const binding = await service.action({ action: 'identify', pid: identity.pid, created: identity.created });
  assert.equal(binding.image.toLowerCase(), fixture.toLowerCase());
  await service.action({
    action: 'configure',
    version: service.view().version,
    settings: {
      enabled: true,
      applications: [
        {
          ...binding,
          rule: { copy: false, paste: true, files: true, sensitive: false, maxTextBytes: 1048576 },
        },
      ],
    },
  });
  assert.equal(service.view().processes.find((item) => item.pid === identity.pid).state, 'enforced');
  assert.equal((await a.request('write', 'service refusal')).ok, false);
  assert.equal((await b.request('write', 'other executable permitted')).ok, true);
  locked = true;
  await assert.rejects(service.action({ action: 'refresh' }), /session locked/);
  c = await launch(fixture, identity.station);
  const third = await c.ready;
  const deadline = Date.now() + 10000;
  while (
    Date.now() < deadline &&
    service.view().processes.find((item) => item.pid === third.pid)?.state !== 'enforced'
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(service.view().processes.find((item) => item.pid === third.pid)?.state, 'enforced');
  assert.equal((await c.request('write', 'new process refused')).ok, false);
  await service.close();
  const controlled = service.view().processes.filter((item) => item.state === 'enforced');
  assert.ok(
    controlled.some((item) => item.pid === identity.pid) && controlled.some((item) => item.pid === third.pid),
  );
  assert.ok(controlled.every((item) => item.image.toLowerCase() === fixture.toLowerCase()));
  assert.equal((await a.request('write', 'closed controller refusal')).ok, false);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).managed.length, controlled.length);
  locked = false;
  const updatedAssets = join(folder, 'updated-assets');
  await cp(assets, updatedAssets, { recursive: true });
  service = new NativeClipboard({ ...options, assets: updatedAssets, interval: 0 });
  await service.init();
  assert.equal(
    service.view().processes.filter((item) => item.state === 'enforced').length,
    controlled.length,
  );
  await service.action({
    action: 'configure',
    version: service.view().version,
    settings: {
      ...service.view().settings,
      applications: service
        .view()
        .settings.applications.map((item) => ({ ...item, rule: { ...item.rule, paste: false } })),
    },
  });
  assert.equal((await a.request('read')).ok, false);
  assert.equal((await a.request('libraries')).count, 1);
  assert.equal((await c.request('libraries')).count, 1);
  assert.equal((await b.request('write', 'controlled launch startup paste probe')).ok, true);
  const literal = [
    '',
    'sp ace',
    'with"quotes',
    'trailing\\',
    '\\"',
    '中文🪷',
    '& $() %PATH% ; >',
    'line\nbreak',
    '\b\f\t\r',
  ];
  started = await launch(fixture, identity.station, (pipe) =>
    service.action({
      action: 'launch',
      version: service.view().version,
      image: binding.image,
      sha256: binding.sha256,
      args: ['--controlled', pipe, identity.station, owner, ...literal],
    }),
  );
  const committed = await started.committed;
  const first = await started.ready;
  assert.equal(first.pid, committed.process.pid);
  assert.equal(first.created, committed.process.created);
  assert.equal(
    first.directory.toLowerCase(),
    dirname(fixture).toLowerCase(),
    'the controlled application receives its complete executable directory',
  );
  assert.equal(first.entryLibrary, true, 'the policy DLL is present at the first statement in wmain');
  assert.equal(first.entryReady, true, 'the saved active policy is ready on entry to wmain');
  assert.equal(
    first.initialCopyBlocked,
    true,
    'the first clipboard mutation is refused in the private station',
  );
  assert.equal(first.initialPasteBlocked, true, 'the first clipboard read is refused in the private station');
  assert.deepEqual(
    first.argv,
    literal,
    'Windows argv quoting preserves every literal argument without a shell',
  );
  assert.equal((await b.request('read')).text, 'controlled launch startup paste probe');
  assert.equal((await started.request('libraries')).count, 1);
  assert.ok(
    JSON.parse(await readFile(file, 'utf8')).managed.some(
      (item) => item.pid === first.pid && item.created === first.created,
    ),
  );
  await service.action({ action: 'refresh' });
  assert.equal((await started.request('libraries')).count, 1, 'scan does not re-inject a controlled launch');
  await service.close();
  assert.equal((await started.request('write', 'closed service startup rule')).ok, false);
  service = new NativeClipboard({ ...options, assets: updatedAssets, interval: 0 });
  await service.init();
  assert.equal(service.view().processes.find((item) => item.pid === first.pid)?.state, 'enforced');
  assert.equal((await started.request('libraries')).count, 1);
  console.log(
    `Actual ${bits}-bit suspended controlled launch entered wmain with policy ready; first copy/paste blocked, literal argv, scan deduplication and restart ownership passed.`,
  );
  const failures = [];
  for (const stage of ['prepared', 'attached'])
    for (const mode of ['eof', 'kill']) failures.push(await failedControlledLaunch(binding, stage, mode));
  failures.push(await failedControlledLaunch(binding, 'attached', 'stdout-loss'));
  console.log(
    `Actual ${bits}-bit prepared/attached EOF and helper death cleaned up only owned children without entering wmain.`,
  );
  console.log(
    `Actual ${bits}-bit commit reply pipe loss after resume triggered explicit cleanup of its owned Job.`,
  );
  const serviceClosures = [];
  for (const stage of ['prepared', 'attached'])
    serviceClosures.push(await closedServiceLaunch(binding, file, stage));
  console.log(
    `Actual ${bits}-bit service close before attachment and before resume aborted the owned child and retained its journal and other policies.`,
  );
  await service.action({
    action: 'configure',
    version: service.view().version,
    settings: { ...service.view().settings, enabled: false },
  });
  assert.equal((await a.request('write', 'service disabled')).ok, true);
  assert.equal((await c.request('write', 'new process disabled')).ok, true);
  assert.equal((await started.request('write', 'controlled launch disabled')).ok, true);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).managed.length, 0);
  console.log(
    'Actual server executable binding, automatic new-process enforcement through UI lock, restart ownership and explicit disable passed.',
  );
  const manifest = JSON.parse(await readFile(join(assets, 'native-clipboard.json'), 'utf8'));
  const proof = join(folder, 'controlled-launch-proof.json');
  await writeFile(
    proof,
    JSON.stringify(
      {
        bits,
        build: manifest.build,
        owner,
        executable: binding,
        privateStation: identity.station,
        committed: committed.process,
        firstMain: first,
        failureCleanup: failures,
        serviceClosures,
        scanDeduplicated: true,
        restartRetainedPolicy: true,
        explicitDisablePassed: true,
      },
      null,
      2,
    ),
  );
  console.log(`Controlled launch proof: ${proof}`);
  console.log(`Native ${bits}-bit fixture passed in an isolated window station.`);
} finally {
  await service?.close();
  await Promise.allSettled([a.close(), b?.close(), c?.close(), started?.close()]);
}
