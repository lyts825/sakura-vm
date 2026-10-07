/**
 * 模块职责：验证真实后代创建继承、精确进程出生身份、Token 参数、恢复和旧版本资产兼容。
 * Module: Verify real descendant inheritance, exact process-birth identities, token parameters, recovery and legacy asset compatibility.
 * 设计思路：编译并驱动自有夹具，在私有 station、独立状态文件与精确出生身份范围内检查实际回执；本脚本会产生临时进程/资产，执行平台及编译器要求由入口校验定义。
 * Design: Compile/drive owned fixtures and check actual receipts within private stations, separate state files and exact process-birth identities. This script creates temporary processes/assets; entry checks define platform/compiler requirements.
 */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, cp, readFile, writeFile, rename, rmdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeClipboard, nativeLaunch, nativeCommand } from '../server/native-clipboard.ts';
import { nativeClipboardDescendants } from '../server/native-clipboard-descendants.ts';

assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');
const tokenMode = process.argv.includes('--token');
const root = resolve(
  process.env.SAKURA_NATIVE_CLIPBOARD_TEST_BASE || '.data/native-clipboard-test-temp',
  (tokenMode ? 'token-' : 'descendant-') + randomUUID(),
);
await mkdir(root, { recursive: true });
process.env.TEMP = process.env.TMP = root;
console.log('Descendant private fixture: ' + root);
const /**
 * 中文功能：计算输入字节的 SHA-256，用于将配置和资产身份绑定到实际内容。
 * English: Compute SHA-256 over input bytes to bind configuration and asset identities to actual content.
 * 输入 / Inputs: bytes。
 * 结果：返回分支计算值（`createHash('sha256').update(bytes).digest('hex')`）。
 * Result: Return the branch-computed value (`createHash('sha256').update(bytes).digest('hex')`).
 * 协作入口 / Collaborators: `createHash('sha256').update(bytes).digest`, `createHash('sha256').update`, `createHash`.
 */
hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  execute = promisify(execFile);
const sourceFiles = [
  'native/windows-clipboard/descendant.h',
  'native/windows-clipboard/descendant-reservation.h',
  'native/windows-clipboard/descendant-token.h',
  'native/windows-clipboard/descendant-policy.h',
  'native/windows-clipboard/shell-provenance.h',
  'native/windows-clipboard/descendant-cleanup.h',
  'native/windows-clipboard/shell-policy.h',
  'native/windows-clipboard/descendant-controller.h',
  'native/windows-clipboard/controller.cpp',
  'native/windows-clipboard/policy.cpp',
  'native/windows-clipboard/ole-text-stream.h',
  'native/windows-clipboard/protocol.h',
  'native/windows-clipboard/early-import.h',
  'native/windows-clipboard/control-system.h',
  'native/windows-clipboard/fixture-descendant.h',
  'native/windows-clipboard/fixture-descendant-dll.cpp',
  'native/windows-clipboard/fixture-descendant-parent.cpp',
  'native/windows-clipboard/fixture-descendant-managed.cs',
  'native/windows-clipboard/fixture-descendant-terminate.cs',
  'native/windows-clipboard/fixture-descendant-token.h',
  'native/windows-clipboard/fixture-descendant-token.cpp',
  'server/native-clipboard.ts',
  'server/native-clipboard-descendants.ts',
  'scripts/build-native-clipboard.mjs',
  'scripts/smoke-native-clipboard-descendants.mjs',
  'scripts/smoke-native-clipboard-token.mjs',
];
const sourceSha256 = Object.fromEntries(
  await Promise.all(sourceFiles.map(async (file) => [file, hash(await readFile(file))])),
);
const proof = {
  version: 1,
  kind: tokenMode
    ? 'actual-createprocess-asuser-descendant-clipboard'
    : 'actual-createprocess-descendant-clipboard',
  passed: false,
  startedAt: new Date().toISOString(),
  sourceSha256,
  sourceUnchanged: false,
  cases: [],
  interactiveClipboardAccessed: false,
  newAccountCreated: false,
  runtimeInstalled: false,
};
const proofPath = join(root, 'descendant-proof.json');
const assets = join(root, 'assets'),
  file = join(root, 'native.json');
const channels = [],
  parents = [],
  children = [];
let service, holding, holderClose, stationIdentity, fault, entered, aborted, latestPrepared;
let brokerGate, adoptionGate, scanGate;
const gates = [],
  nativeCalls = [];
/**
 * 中文功能：创建用于创建或接纳边界的门闩，捕获进入证据并等待用例明确放行。
 * English: Create a creation/adoption boundary gate, capture entry evidence and await explicit case release.
 * 输入 / Inputs: stage。
 * 结果：返回分支计算值（`point`）。
 * Result: Return the branch-computed value (`point`).
 * 协作入口 / Collaborators: `gates.push`.
 */
function gatePoint(stage) {
  let enter, release;
  const point = {
    stage,
    ready: new Promise((resolve) => {
      enter = resolve;
    }),
    waiting: new Promise((resolve) => {
      release = resolve;
    }),
    /**
     * 中文功能：提交门闩进入证据，并沿本实现等待用例的放行信号。
     * English: Submit gate-entry evidence and follow this implementation in awaiting case release.
     * 输入 / Inputs: value。
     * 结果：返回分支计算值（`enter(value)`）。
     * Result: Return the branch-computed value (`enter(value)`).
     * 协作入口 / Collaborators: `enter`.
     */
    enter: (value) => enter(value),
    /**
     * 中文功能：完成预先保存的门闩 Promise，使等待创建流程继续。
     * English: Settle the retained gate Promise so a waiting creation flow can continue.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`release()`）。
     * Result: Return the branch-computed value (`release()`).
     * 协作入口 / Collaborators: `release`.
     */
    release: () => release(),
  };
  gates.push(point);
  return point;
}
const options = {
  file,
  assets,
  interval: 0,
  /**
   * 中文功能：调用真实原生控制器并保留本轮命令或回执记录，供后续生命周期断言使用。
   * English: Invoke the real native controller and retain command/receipt records for later lifecycle assertions.
   * 输入 / Inputs: helper; args。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 状态影响 / State effects: `point.used`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `nativeCalls.push`, `nativeCommand`, `String`, `point.enter`.
   */
  run: async (helper, args) => {
    nativeCalls.push([...args]);
    const result = await nativeCommand(helper, args);
    const point = scanGate;
    if (point && !point.used && args[0] === point.stage && (!point.pid || args[2] === String(point.pid))) {
      point.used = true;
      point.enter(result);
      await point.waiting;
    }
    return result;
  },
  /**
   * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
   * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
   * 输入 / Inputs: helper; owner; receive; failed。
   * 结果：返回分支计算值（`wrapped`），以 Promise 交付。
   * Result: Return the branch-computed value (`wrapped`) through a Promise.
   * 协作入口 / Collaborators: `nativeClipboardDescendants`.
   */
  descendants: async (helper, owner, receive, failed) => {
    const channel = await nativeClipboardDescendants(
        helper,
        owner,
        async (request, broker) => {
          const point = brokerGate;
          if (point && !point.used) {
            point.used = true;
            point.enter(request);
            await point.waiting;
          }
          return receive(request, broker);
        },
        (error) => {
          (proof.channelErrors ||= []).push({ at: new Date().toISOString(), message: error.message });
          console.log('Descendant channel: ' + error.message);
          failed(error);
        },
      ),
      wrapped = {
        /**
         * 中文功能：计算本轮原生验收的辅助值；输入与分支结果如下，供相邻创建或断言步骤使用。
         * English: Compute a helper value for this native smoke; inputs and branch results below serve adjacent creation/assertion steps.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`channel.alive`）。
         * Result: Return the branch-computed value (`channel.alive`).
         */
        get alive() {
          return channel.alive;
        },
        /**
         * 中文功能：关闭本夹具拥有的进程、流或管道；具体等待期限和强制终止条件以本函数分支为准。
         * English: Close processes, streams or pipes owned by this fixture; its branches define wait deadlines and forced-termination conditions.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 状态影响 / State effects: `proof.channelClosures`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
         * 协作入口 / Collaborators: `channel.close`, `assert.ok`, `(proof.channelClosures ||= []).push`.
         * 检查边界 / Checked boundaries: `assert.ok(channel.closure, 'broker close waits for actual process and stdout/stderr close')`.
         */
        async close() {
          await channel.close();
          assert.ok(channel.closure, 'broker close waits for actual process and stdout/stderr close');
          (proof.channelClosures ||= []).push({ process: channel.process, ...channel.closure });
        },
      };
    return wrapped;
  },
  /**
   * 中文功能：协调本脚本的真实 Windows 创建或附着阶段，返回下述回执供身份与策略断言核对。
   * English: Coordinate this script's real Windows creation/attachment stage, returning the receipt below for identity/policy assertions.
   * 输入 / Inputs: helper; args; hooks; signal。
   * 结果：返回分支计算值（`nativeLaunch( helper, args, { prepared: async (process) => { if (args[0] === 'ad…`）。
   * Result: Return the branch-computed value (`nativeLaunch( helper, args, { prepared: async (process) => { if (args[0] === 'ad…`).
   * 协作入口 / Collaborators: `nativeLaunch`.
   */
  launch: (helper, args, hooks, signal) =>
    nativeLaunch(
      helper,
      args,
      {
        /**
         * 中文功能：协调本脚本的真实 Windows 创建或附着阶段，返回下述回执供身份与策略断言核对。
         * English: Coordinate this script's real Windows creation/attachment stage, returning the receipt below for identity/policy assertions.
         * 输入 / Inputs: process。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 状态影响 / State effects: `latestPrepared`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
         * 失败 / Failure: `new Error('owned descendant prepared-stage refusal')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         * 协作入口 / Collaborators: `hooks.prepared`, `point.enter`, `entered`.
         * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
         * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
         */
        prepared: async (process) => {
          if (args[0] === 'adopt') latestPrepared = process;
          await hooks.prepared(process);
          if (args[0] !== 'adopt') return;
          if (adoptionGate?.stage === 'prepared') {
            const point = adoptionGate;
            point.enter(process);
            await point.waiting;
          }
          if (fault === 'prepared') throw new Error('owned descendant prepared-stage refusal');
          if (fault === 'gate') {
            entered?.(process);
            await new Promise((_, reject) => {
              /**
               * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
               * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
               * 输入 / Inputs: 无 / none。
               * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
               * Result: No explicit result value; callers observe completion, state changes or an exception.
               * 状态影响 / State effects: `aborted`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
               * 协作入口 / Collaborators: `reject`.
               */
              const stop = () => {
                aborted = true;
                reject(new Error('owned descendant generation retired'));
              };
              if (signal.aborted) stop();
              else signal.addEventListener('abort', stop, { once: true });
            });
          }
        },
        /**
         * 中文功能：协调本脚本的真实 Windows 创建或附着阶段，返回下述回执供身份与策略断言核对。
         * English: Coordinate this script's real Windows creation/attachment stage, returning the receipt below for identity/policy assertions.
         * 输入 / Inputs: process; state。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 失败 / Failure: `new Error('owned descendant attached-stage refusal')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         * 协作入口 / Collaborators: `hooks.attached`, `point.enter`.
         */
        attached: async (process, state) => {
          await hooks.attached(process, state);
          if (args[0] === 'adopt' && adoptionGate?.stage === 'attached') {
            const point = adoptionGate;
            point.enter(process);
            await point.waiting;
          }
          if (args[0] === 'adopt' && fault === 'attached')
            throw new Error('owned descendant attached-stage refusal');
        },
      },
      signal,
    ),
};
/**
 * 中文功能：建立本轮自有命名管道，解析夹具逐行 JSON 回执，暴露写入、等待与关闭入口。
 * English: Create an owned named pipe, parse line-delimited fixture JSON receipts, and expose write/wait/close operations.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`result`），以 Promise 交付。
 * Result: Return the branch-computed value (`result`) through a Promise.
 * 协作入口 / Collaborators: `randomUUID`, `createServer`, `server.on`, `pipe.substring`.
 */
async function channel() {
  const pipe = '\\\\.\\pipe\\SakuraDescendantFixture.' + randomUUID(),
    server = createServer();
  let socket,
    reader,
    ended = false;
  const queued = [],
    waiting = [];
  server.on('connection', /**
   * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
   * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
   * 输入 / Inputs: connection。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `socket`, `reader`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `connection.destroy`, `createInterface`, `reader.on`, `socket.on`.
   */
  (connection) => {
    if (socket) {
      connection.destroy();
      return;
    }
    socket = connection;
    reader = createInterface({ input: connection });
    reader.on('line', (line) => {
      const value = JSON.parse(line);
      if (waiting.length) waiting.shift().resolve(value);
      else queued.push(value);
    });
    socket.on('close', () => {
      ended = true;
      for (const item of waiting.splice(0)) item.reject(new Error('owned descendant fixture pipe closed'));
    });
  });
  await new Promise((yes, no) => {
    server.once('error', no);
    server.listen(pipe, yes);
  });
  const result = {
    pipe,
    name: pipe.substring(9),
    /**
     * 中文功能：向当前夹具管道写入命令；连接未建立或已结束时按本表达式处理。
     * English: Write a command to the fixture pipe; this expression handles absent or ended connections.
     * 输入 / Inputs: text。
     * 结果：返回分支计算值（`!ended && socket?.write(text)`）。
     * Result: Return the branch-computed value (`!ended && socket?.write(text)`).
     * 协作入口 / Collaborators: `socket?.write`.
     */
    write: (text) => !ended && socket?.write(text),
    /**
     * 中文功能：优先取已排队回执，否则登记等待者；关闭或超时通过本分支的拒绝路径结束等待。
     * English: Consume a queued receipt first or register a waiter; the implemented closure/timeout rejection path ends pending waits.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`queued.length ? Promise.resolve(queued.shift()) : ended ? Promise.reject(new Err…`）。
     * Result: Return the branch-computed value (`queued.length ? Promise.resolve(queued.shift()) : ended ? Promise.reject(new Err…`).
     * 协作入口 / Collaborators: `Promise.resolve`, `queued.shift`, `Promise.reject`.
     */
    next: () =>
      queued.length
        ? Promise.resolve(queued.shift())
        : ended
          ? Promise.reject(new Error('owned fixture already closed'))
          : new Promise(/**
           * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
           * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
           * 输入 / Inputs: resolve; reject。
           * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
           * Result: No explicit result value; callers observe completion, state changes or an exception.
           * 协作入口 / Collaborators: `setTimeout`, `waiting.push`.
           */
          (resolve, reject) => {
              const item = {
                /**
                 * 中文功能：清除本等待者的超时定时器并完成其成功结果。
                 * English: Clear this waiter's timeout and settle its successful result.
                 * 输入 / Inputs: value。
                 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
                 * Result: No explicit result value; callers observe completion, state changes or an exception.
                 * 协作入口 / Collaborators: `clearTimeout`, `resolve`.
                 */
                resolve: (value) => {
                  clearTimeout(timer);
                  resolve(value);
                },
                /**
                 * 中文功能：清除本等待者的超时定时器并交付失败原因。
                 * English: Clear this waiter's timeout and deliver its rejection reason.
                 * 输入 / Inputs: error。
                 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
                 * Result: No explicit result value; callers observe completion, state changes or an exception.
                 * 协作入口 / Collaborators: `clearTimeout`, `reject`.
                 */
                reject: (error) => {
                  clearTimeout(timer);
                  reject(error);
                },
              };
              const timer = setTimeout(() => {
                const index = waiting.indexOf(item);
                if (index >= 0) waiting.splice(index, 1);
                reject(new Error('owned descendant fixture timed out: ' + pipe));
              }, 40000);
              waiting.push(item);
            }),
    /**
     * 中文功能：关闭本夹具拥有的进程、流或管道；具体等待期限和强制终止条件以本函数分支为准。
     * English: Close processes, streams or pipes owned by this fixture; its branches define wait deadlines and forced-termination conditions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `socket?.destroy`, `reader?.close`.
     */
    close: async () => {
      socket?.destroy();
      reader?.close();
      await new Promise((yes) => server.close(yes));
    },
    /**
     * 中文功能：读取本管道是否已有连接，供入口未执行的断言观察。
     * English: Read whether this pipe has a connection for assertions that an entry did not execute.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`!!socket`）。
     * Result: Return the branch-computed value (`!!socket`).
     */
    get connected() {
      return !!socket;
    },
  };
  channels.push(result);
  return result;
}
/**
 * 中文功能：使用本轮选定编译器和固定构建选项生成自有夹具，供后续真实原生调用验收。
 * English: Build an owned fixture with the selected compiler and fixed build options for subsequent real native-call acceptance.
 * 输入 / Inputs: compiler; args; name。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 失败 / Failure: `error`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `execute`, `writeFile`, `join`, `String`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function compile(compiler, args, name) {
  try {
    const result = await execute(compiler, args, { windowsHide: true, timeout: 60000 });
    await writeFile(join(root, name + '.compile.log'), result.stdout + result.stderr);
  } catch (error) {
    await writeFile(
      join(root, name + '.compile.log'),
      String(error.stdout || '') + String(error.stderr || '') + '\n' + error.message,
    );
    throw error;
  }
}
/**
 * 中文功能：通过原生控制器读取实时进程清单，供精确 PID/出生时间断言使用。
 * English: Read live process inventory through the native controller for exact PID/birth-time assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`JSON.parse( ( await execute(join(assets, 'sakura-clipboard-controller.exe'), ['l…`），以 Promise 交付。
 * Result: Return the branch-computed value (`JSON.parse( ( await execute(join(assets, 'sakura-clipboard-controller.exe'), ['l…`) through a Promise.
 * 协作入口 / Collaborators: `JSON.parse`, `execute`, `join`.
 */
async function inventory() {
  return JSON.parse(
    (
      await execute(join(assets, 'sakura-clipboard-controller.exe'), ['list'], {
        windowsHide: true,
        timeout: 10000,
      })
    ).stdout,
  ).processes;
}
/**
 * 中文功能：同时比较 PID 和创建时间，区分原进程、PID 复用者与邻居。
 * English: Compare both PID and creation time to distinguish the original process from PID reuse and neighbors.
 * 输入 / Inputs: left; right。
 * 结果：返回分支计算值（`left.pid === right.pid && left.created === right.created`）。
 * Result: Return the branch-computed value (`left.pid === right.pid && left.created === right.created`).
 */
const same = (left, right) => left.pid === right.pid && left.created === right.created;
/**
 * 中文功能：在限定时间内轮询原进程身份消失；匹配完整身份而不只依据 PID。
 * English: Poll within a fixed deadline for the original process identity to disappear, matching complete identity rather than only PID.
 * 输入 / Inputs: process。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 失败 / Failure: `new Error('owned descendant remains alive: ' + JSON.stringify(process))`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `Date.now`, `(await inventory()).some`, `inventory`, `delay`.
 */
async function gone(process) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (!(await inventory()).some((item) => same(item, process))) return;
    await delay(100);
  }
  throw new Error('owned descendant remains alive: ' + JSON.stringify(process));
}
/**
 * 中文功能：读取持久状态文件中的 owner 标识，供原生控制器核对本服务的归属。
 * English: Read the owner identifier from persisted state for native-controller ownership checks.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`JSON.parse(await readFile(file, 'utf8')).owner`），以 Promise 交付。
 * Result: Return the branch-computed value (`JSON.parse(await readFile(file, 'utf8')).owner`) through a Promise.
 * 协作入口 / Collaborators: `JSON.parse`, `readFile`.
 */
async function owner() {
  return JSON.parse(await readFile(file, 'utf8')).owner;
}
/**
 * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
 * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
 * 输入 / Inputs: process。
 * 结果：返回分支计算值（`nativeCommand(join(assets, 'sakura-clipboard-controller.exe'), [ 'status', await…`），以 Promise 交付。
 * Result: Return the branch-computed value (`nativeCommand(join(assets, 'sakura-clipboard-controller.exe'), [ 'status', await…`) through a Promise.
 * 协作入口 / Collaborators: `nativeCommand`, `join`, `owner`, `String`.
 */
async function actualStatus(process) {
  return nativeCommand(join(assets, 'sakura-clipboard-controller.exe'), [
    'status',
    await owner(),
    String(process.pid),
    process.created,
  ]);
}
/**
 * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
 * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
 * 输入 / Inputs: process; maximum = 1048576。
 * 结果：返回分支计算值（`nativeCommand(join(assets, 'sakura-clipboard-controller' + suffix + '.exe'), [ '…`），以 Promise 交付。
 * Result: Return the branch-computed value (`nativeCommand(join(assets, 'sakura-clipboard-controller' + suffix + '.exe'), [ '…`) through a Promise.
 * 协作入口 / Collaborators: `nativeCommand`, `join`, `owner`, `String`.
 */
async function ordinaryApply(process, maximum = 1048576) {
  const suffix = process.bits === 32 ? '-x86' : '';
  return nativeCommand(join(assets, 'sakura-clipboard-controller' + suffix + '.exe'), [
    'apply',
    await owner(),
    String(process.pid),
    process.created,
    process.image,
    join(assets, 'SakuraClipboardPolicy' + suffix + '.dll'),
    '8',
    String(maximum),
    '1',
  ]);
}
/**
 * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
 * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
 * 输入 / Inputs: process; offset。
 * 结果：返回分支计算值（`nativeCalls .slice(offset) .filter((args) => args[0] === 'apply' && args[2] === …`）。
 * Result: Return the branch-computed value (`nativeCalls .slice(offset) .filter((args) => args[0] === 'apply' && args[2] === …`).
 * 协作入口 / Collaborators: `nativeCalls .slice(offset) .filter`, `nativeCalls .slice`.
 */
const scannedApplies = (process, offset) =>
  nativeCalls
    .slice(offset)
    .filter((args) => args[0] === 'apply' && args[2] === String(process.pid) && args[3] === process.created)
    .length;
/**
 * 中文功能：检查本轮真实原生回执和状态，以下断言摘录给出本函数具体核对的边界。
 * English: Check real native receipts/state from this run; assertion excerpts below identify the boundaries checked by this function.
 * 输入 / Inputs: child; ancestor。
 * 结果：返回受控对象，公开字段包括 `parent, entry, inheritance, state`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `parent, entry, inheritance, state`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `child.connection.next`, `assert.equal`, `service.view().available.find`, `service.view`.
 * 检查边界 / Checked boundaries: `assert.equal(entry.entryReady, true)`; `assert.equal(entry.pid, child.process.pid)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function sameExeParent(child, ancestor) {
  const entry = await child.connection.next();
  assert.equal(entry.entryReady, true);
  assert.equal(entry.pid, child.process.pid);
  assert.equal(entry.created, child.process.created);
  const process = service.view().available.find((item) => same(item, child.process));
  assert.ok(process);
  const duplicate = children.findIndex((item) => same(item.process, child.process));
  if (duplicate >= 0) children.splice(duplicate, 1);
  const adopted = { process, connection: child.connection, evidence: entry };
  parents.push(adopted);
  const journal = JSON.parse(await readFile(file, 'utf8')).managed.find((item) => same(item, process));
  assert.equal(journal.inheritance.parent.pid, ancestor.process.pid);
  assert.equal(journal.inheritance.parent.created, ancestor.process.created);
  const state = await actualStatus(process);
  assert.equal(state.ready, true);
  assert.equal(state.active, true);
  assert.equal(state.reserved, false);
  return { parent: adopted, entry, inheritance: journal.inheritance, state };
}
/**
 * 中文功能：检查本轮真实原生回执和状态，以下断言摘录给出本函数具体核对的边界。
 * English: Check real native receipts/state from this run; assertion excerpts below identify the boundaries checked by this function.
 * 输入 / Inputs: image; initialization。
 * 结果：返回分支计算值（`parent`），以 Promise 交付。
 * Result: Return the branch-computed value (`parent`) through a Promise.
 * 协作入口 / Collaborators: `channel`, `service.view().settings.applications.find`, `service.view`, `owner`.
 * 检查边界 / Checked boundaries: `assert.equal(evidence.entryReady, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function parentLaunch(image, initialization) {
  const connection = await channel(),
    selected = service.view().settings.applications.find((item) => item.image === image);
  const args = [
    '--descendant-station=' + stationIdentity.station,
    '--descendant-owner=' + (await owner()),
    '--descendant-pipe=' + connection.pipe,
  ];
  if (initialization)
    args.push(
      '--spawn-phase=' + initialization.phase,
      '--spawn-child=' + initialization.image,
      '--spawn-pipe=' + initialization.connection.pipe,
      '--spawn-kind=' + initialization.kind,
      '--spawn-marker=' + initialization.marker,
    );
  if (initialization?.api) args.push('--spawn-api=' + initialization.api);
  const result = await service.action({
    action: 'launch',
    version: service.view().version,
    image,
    sha256: selected.sha256,
    args,
  });
  const evidence = await connection.next();
  assert.equal(evidence.entryReady, true);
  const parent = { process: result.process, connection, evidence };
  parents.push(parent);
  return parent;
}
/**
 * 中文功能：协调本脚本的真实 Windows 创建或附着阶段，返回下述回执供身份与策略断言核对。
 * English: Coordinate this script's real Windows creation/attachment stage, returning the receipt below for identity/policy assertions.
 * 输入 / Inputs: parent; image; kind = 'native'; mode = 'W'; expected = true; markerPath。
 * 结果：返回受控对象，公开字段包括 `process, connection, marker, image, ancestor`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `process, connection, marker, image, ancestor`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `channel`, `join`, `randomUUID`, `parent.connection.write`.
 * 检查边界 / Checked boundaries: `assert.equal( process.started, expected, JSON.stringify({ process, error: service.view().error, processes: service.view().processe…`; `assert.equal(process.token.sourceObserved, true)`.
 */
async function childSpawn(parent, image, kind = 'native', mode = 'W', expected = true, markerPath) {
  const connection = await channel(),
    marker = markerPath || join(root, 'marker-' + randomUUID());
  parent.connection.write(
    ['spawn', mode, image, connection.pipe, kind, marker, dirname(image)].join('\t') + '\n',
  );
  const process = await parent.connection.next();
  if (expected !== null)
    assert.equal(
      process.started,
      expected,
      JSON.stringify({ process, error: service.view().error, processes: service.view().processes }),
    );
  if (expected === true && process.started && mode.startsWith('as-user-')) {
    assert.equal(process.token.sourceObserved, true);
    assert.equal(process.token.sourceUnchanged, true);
    assert.equal(process.token.sourceModifiedBefore, process.token.sourceModifiedAfter);
  }
  if (process.started) children.push({ process, connection, marker, ancestor: parent });
  return { process, connection, marker, image, ancestor: parent };
}
/**
 * 中文功能：核对原生或托管孩子的入口阶段、策略状态和持久继承记录，返回完整孩子与父级证据。
 * English: Check native/managed child entry phases, policy state and durable inheritance records, returning complete child/ancestor evidence.
 * 输入 / Inputs: child; ancestor; kind = 'native'; source = ancestor.process。
 * 结果：返回受控对象，公开字段包括 `process, inheritance, evidence`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `process, inheritance, evidence`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `child.connection.next`, `assert.equal`, `existsSync`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(existsSync(child.marker), true)`; `assert.equal(evidence.pid, child.process.pid)`.
 * 设计思路：把入口实际回执与持久 journal 交叉核对，校验父出生身份和应用内容摘要；同名程序或可达管道本身不足以证明继承归属。
 * Design: Cross-check actual entry receipts with the durable journal, including parent birth identity and application digest; program names or reachable pipes alone do not establish inheritance ownership.
 */
async function verifyChild(child, ancestor, kind = 'native', source = ancestor.process) {
  const evidence = await child.connection.next();
  assert.equal(existsSync(child.marker), true);
  if (kind === 'native') {
    assert.equal(evidence.pid, child.process.pid);
    assert.equal(evidence.created, child.process.created);
    assert.equal(evidence.phases.length, 4);
    for (const phase of evidence.phases) {
      assert.equal(phase.ready, true);
      assert.equal(phase.active, true);
      assert.equal(phase.privateStation, true);
      assert.equal(phase.flags, 8);
      assert.equal(phase.copyError, 5);
      assert.equal(phase.pasteError, 5);
      assert.equal(phase.oleCopy, 0x80070005);
      assert.equal(phase.olePaste, 0x80070005);
    }
  } else {
    assert.equal(evidence.phases.length, 2);
    for (const phase of evidence.phases) {
      assert.equal(phase.pid, child.process.pid);
      assert.equal(phase.created, child.process.created);
      assert.equal(phase.ready, true);
      assert.equal(phase.privateStation, true);
      assert.equal(phase.copyError, 5);
      assert.equal(phase.pasteError, 5);
      assert.equal(phase.oleCopy, 0x80070005);
      assert.equal(phase.olePaste, 0x80070005);
    }
  }
  const journal = JSON.parse(await readFile(file, 'utf8')),
    managed = journal.managed.find((item) => same(item, child.process));
  assert.ok(managed, 'the exact child has durable ownership before any application callback');
  assert.equal(managed.inheritance.parent.pid, ancestor.process.pid);
  assert.equal(managed.inheritance.parent.created, ancestor.process.created);
  assert.equal(managed.inheritance.application.image, source.image);
  assert.equal(managed.sha256, hash(await readFile(managed.image)));
  return { process: child.process, inheritance: managed.inheritance, evidence };
}
const tokenLiteral = 'empty space 中文 \\ trailing\\ "quoted"';
/**
 * 中文功能：核对 Token 启动孩子的原参数、目录、会话和授权身份，并通过祖先进程核实标准句柄对象。
 * English: Check token-launched child parameters, directory, session and authentication identity, then have its ancestor verify standard-handle objects.
 * 输入 / Inputs: child; active = true; remappedHandles = false。
 * 结果：返回受控对象，公开字段包括 `process, evidence, standardHandleIdentity`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `process, evidence, standardHandleIdentity`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `child.connection.next`, `assert.equal`, `dirname`, `evidence.argv.at`.
 * 检查边界 / Checked boundaries: `assert.equal(evidence.pid, child.process.pid)`; `assert.equal(evidence.created, child.process.created)`.
 * 设计思路：数值句柄可按选项重新映射，因此在允许重映射时跳过数值相等，但仍要求祖先确认同一底层对象；参数中的空字符串及含空格转义值必须原样保留。
 * Design: Handle numbers may be remapped, so permitted remapping skips numeric equality but still requires ancestor confirmation of the same underlying objects. Preserve empty arguments and escaped values containing spaces.
 */
async function verifyTokenParameters(child, active = true, remappedHandles = false) {
  const evidence = await child.connection.next();
  assert.equal(evidence.pid, child.process.pid);
  assert.equal(evidence.created, child.process.created);
  assert.equal(evidence.entryReady, active);
  assert.equal(evidence.station, stationIdentity.station);
  assert.equal(evidence.directory, dirname(child.image));
  assert.equal(evidence.literal, tokenLiteral);
  assert.equal(evidence.argv.at(-1), '');
  assert.equal(evidence.argv.at(-2), '--token-literal=' + tokenLiteral);
  assert.equal(evidence.session, child.process.token.session);
  assert.equal(evidence.tokenType, 1);
  assert.equal(evidence.authentication, child.process.token.authentication);
  assert.equal(child.process.token.sameUser, true);
  if (!remappedHandles)
    for (const handle of ['stdin', 'stdout', 'stderr'])
      assert.equal(evidence[handle], child.process.token[handle]);
  child.ancestor.connection.write(
    ['std-identities', String(child.process.pid), evidence.stdin, evidence.stdout, evidence.stderr].join(
      '\t',
    ) + '\n',
  );
  const standardHandleIdentity = await child.ancestor.connection.next();
  assert.equal(standardHandleIdentity.stdSameObjects, true);
  assert.equal(existsSync(child.marker), true);
  return { process: child.process, evidence, standardHandleIdentity };
}
/**
 * 中文功能：检查本轮真实原生回执和状态，以下断言摘录给出本函数具体核对的边界。
 * English: Check real native receipts/state from this run; assertion excerpts below identify the boundaries checked by this function.
 * 输入 / Inputs: image。
 * 结果：返回分支计算值（`parent`），以 Promise 交付。
 * Result: Return the branch-computed value (`parent`) through a Promise.
 * 协作入口 / Collaborators: `channel`, `randomUUID`, `spawn`, `arguments_.map`.
 * 检查边界 / Checked boundaries: `assert.equal(evidence.entryReady, false)`.
 */
async function bareParent(image) {
  const connection = await channel(),
    arguments_ = [
      '--descendant-station=' + stationIdentity.station,
      '--descendant-owner=' + randomUUID(),
      '--descendant-pipe=' + connection.pipe,
    ];
  const fixture = spawn(
    image,
    arguments_.map((value) => '"' + value + '"'),
    { windowsHide: true, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  fixture.stdout.resume();
  fixture.stderr.resume();
  const close = new Promise((resolve) => {
    fixture.once('close', (code, signal) => {
      const receipt = { pid: fixture.pid, code, signal, at: new Date().toISOString() };
      (proof.bareFixtureClosures ||= []).push(receipt);
      resolve(receipt);
    });
  });
  const evidence = await connection.next();
  assert.equal(evidence.entryReady, false);
  const parent = { process: { ...evidence, image, bits: 64 }, connection, close };
  parents.push(parent);
  return parent;
}
/**
 * 中文功能：在显式提供旧 v5/v6 资产时核对摘要并运行后代继承、服务恢复和禁用清理回归。
 * English: When legacy v5/v6 assets are supplied explicitly, verify their digests and exercise descendant inheritance, service recovery and disable cleanup.
 * 输入 / Inputs: image; childImage; version = 5。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 状态影响 / State effects: `legacy`, `proof[`legacyV${version}Validated`]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `join`, `cp`, `resolve`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(legacyManifest.version, version)`; `assert.equal(hash(await readFile(join(legacyAssets, entry.name))), entry.sha256)`.
 * 设计思路：使用独立旧版资产副本和状态文件，先核对所有清单项再运行；关闭重建后继续生孩子以验证恢复，最终禁用检查归属记录与策略状态，finally 关闭旧服务。
 * Design: Use separate legacy asset copies and state files, verifying every manifest entry first. Spawn again after service reconstruction to check recovery, then disable and check ownership/policy state; finally closes the legacy service.
 */
async function legacyAssetsRoundtrip(image, childImage, version = 5) {
  const originalAssets = process.env[version === 5 ? 'SAKURA_NATIVE_CLIPBOARD_LEGACY_ASSETS' : 'SAKURA_NATIVE_CLIPBOARD_LEGACY_ASSETS6'];
  if (!originalAssets) return;
  const legacyAssets = join(root, `legacy-v${version}-assets`);
  await cp(resolve(originalAssets), legacyAssets, { recursive: true });
  const legacyManifest = JSON.parse(await readFile(join(legacyAssets, 'native-clipboard.json'), 'utf8'));
  assert.equal(legacyManifest.version, version);
  for (const entry of legacyManifest.files)
    assert.equal(hash(await readFile(join(legacyAssets, entry.name))), entry.sha256);
  const legacyFile = join(root, `legacy-v${version}-native.json`);
  const legacyOptions = { ...options, assets: legacyAssets, file: legacyFile };
  let legacy = new NativeClipboard(legacyOptions);
  try {
    await legacy.init();
    const digest = hash(await readFile(image));
    await legacy.action({
      action: 'configure',
      version: legacy.view().version,
      settings: {
        enabled: true,
        applications: [
          {
            image,
            sha256: digest,
            rule: { copy: false, paste: false, files: false, sensitive: true, maxTextBytes: 1048576 },
          },
        ],
      },
    });
    const connection = await channel();
    const legacyOwner = JSON.parse(await readFile(legacyFile, 'utf8')).owner;
    const launched = await legacy.action({
      action: 'launch',
      version: legacy.view().version,
      image,
      sha256: digest,
      args: [
        '--descendant-station=' + stationIdentity.station,
        '--descendant-owner=' + legacyOwner,
        '--descendant-pipe=' + connection.pipe,
      ],
    });
    const entry = await connection.next();
    assert.equal(entry.entryReady, true);
    const ancestor = { process: launched.process, connection, evidence: entry };
    parents.push(ancestor);
    /**
     * 中文功能：检查本轮真实原生回执和状态，以下断言摘录给出本函数具体核对的边界。
     * English: Check real native receipts/state from this run; assertion excerpts below identify the boundaries checked by this function.
     * 输入 / Inputs: mode = 'W'。
     * 结果：返回受控对象，公开字段包括 `process, inheritance, evidence`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `process, inheritance, evidence`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `childSpawn`, `child.connection.next`, `assert.equal`, `JSON.parse(await readFile(legacyFile, 'utf8')).managed.find`.
     * 检查边界 / Checked boundaries: `assert.equal(evidence.phases.length, 4)`; `assert.equal(phase.ready, true)`.
     * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
     * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
     */
    const verify = async (mode = 'W') => {
      const child = await childSpawn(ancestor, childImage, 'native', mode);
      const evidence = await child.connection.next();
      assert.equal(evidence.phases.length, 4);
      for (const phase of evidence.phases) {
        assert.equal(phase.ready, true);
        assert.equal(phase.active, true);
        assert.equal(phase.flags, 8);
        assert.equal(phase.privateStation, true);
        assert.equal(phase.copyError, 5);
        assert.equal(phase.pasteError, 5);
        assert.equal(phase.oleCopy, 0x80070005);
        assert.equal(phase.olePaste, 0x80070005);
      }
      const managed = JSON.parse(await readFile(legacyFile, 'utf8')).managed.find((item) =>
        same(item, child.process),
      );
      assert.equal(managed.inheritance.parent.pid, ancestor.process.pid);
      assert.equal(managed.inheritance.parent.created, ancestor.process.created);
      assert.equal(managed.inheritance.application.image, image);
      assert.equal(managed.inheritance.application.sha256, digest);
      return { process: child.process, inheritance: managed.inheritance, evidence };
    };
    const before = await verify();
    await legacy.close();
    legacy = new NativeClipboard(legacyOptions);
    await legacy.init();
    assert.equal(legacy.view().processes.find((item) => same(item, before.process))?.state, 'enforced');
    const after = await verify(version === 6 ? 'as-user-W' : 'W');
    await legacy.action({
      action: 'configure',
      version: legacy.view().version,
      settings: { enabled: false, applications: [] },
    });
    assert.equal(JSON.parse(await readFile(legacyFile, 'utf8')).managed.length, 0);
    const state = await nativeCommand(join(legacyAssets, 'sakura-clipboard-controller.exe'), [
      'status',
      legacyOwner,
      String(ancestor.process.pid),
      ancestor.process.created,
    ]);
    assert.equal(state.active, false);
    proof.cases.push({
      kind: `actual-v${version}-assets-retain-ordinary-descendants-recovery-and-disable`,
      build: legacyManifest.build,
      assets: legacyManifest.files,
      ancestor: ancestor.process,
      before,
      after,
      disabledState: state,
    });
    proof[`legacyV${version}Validated`] = true;
  } finally {
    await legacy.close();
  }
}
try {
  await cp(resolve('.tools/native-clipboard'), assets, { recursive: true });
  const manifest = JSON.parse(await readFile(join(assets, 'native-clipboard.json'), 'utf8'));
  assert.equal(manifest.version, 8);
  proof.build = manifest.build;
  proof.assets = manifest.files;
  const compiler64 = process.env.SAKURA_NATIVE_CLIPBOARD_CXX || 'g++.exe',
    compiler32 =
      process.env.SAKURA_NATIVE_CLIPBOARD_CXX32 || resolve('.tools/mingw32-16.2.0/mingw32/bin/g++.exe');
  const common = ['-std=c++17', '-O2', '-s', '-static', '-Wl,--no-insert-timestamp'];
  const nativeParents = {},
    nativeChildren = {},
    tokenChildren = {};
  for (const [bits, compiler] of [
    [64, compiler64],
    [32, compiler32],
  ]) {
    const folder = join(root, String(bits));
    await mkdir(folder);
    const earlyImport = join(folder, 'libEarlySakuraProbe.a'),
      initImport = join(folder, 'libDescendantInitializer.a');
    await compile(
      compiler,
      [
        ...common,
        '-shared',
        '-Wl,--out-implib,' + earlyImport,
        resolve('native/windows-clipboard/fixture-early-dll.cpp'),
        '-o',
        join(folder, 'EarlySakuraProbe.dll'),
        '-lole32',
      ],
      'child-probe-' + bits,
    );
    await compile(
      compiler,
      [
        ...common,
        '-municode',
        resolve('native/windows-clipboard/fixture-early.cpp'),
        earlyImport,
        '-o',
        join(folder, 'child.exe'),
        '-lole32',
      ],
      'child-' + bits,
    );
    await compile(
      compiler,
      [
        ...common,
        '-shared',
        '-Wl,--out-implib,' + initImport,
        resolve('native/windows-clipboard/fixture-descendant-dll.cpp'),
        '-o',
        join(folder, 'DescendantInitializer.dll'),
        '-ladvapi32',
      ],
      'parent-initializer-' + bits,
    );
    await compile(
      compiler,
      [
        ...common,
        '-municode',
        resolve('native/windows-clipboard/fixture-descendant-parent.cpp'),
        initImport,
        '-o',
        join(folder, 'parent.exe'),
        '-luser32',
        '-ladvapi32',
      ],
      'parent-' + bits,
    );
    nativeParents[bits] = join(folder, 'parent.exe');
    nativeChildren[bits] = join(folder, 'child.exe');
    if (tokenMode) {
      tokenChildren[bits] = join(folder, 'token-child.exe');
      await compile(
        compiler,
        [
          ...common,
          '-municode',
          resolve('native/windows-clipboard/fixture-descendant-token.cpp'),
          '-o',
          tokenChildren[bits],
          '-ladvapi32',
          '-lshell32',
          '-luser32',
        ],
        'token-child-' + bits,
      );
    }
  }
  const holder = join(root, 'station.exe');
  await compile(
    compiler64,
    [
      ...common,
      '-municode',
      resolve('native/windows-clipboard/fixture.cpp'),
      '-o',
      holder,
      '-lole32',
      '-luuid',
      '-lshell32',
      '-ladvapi32',
    ],
    'station',
  );
  const managedCompiler = join(
    process.env.SystemRoot || 'C:\\Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  );
  const terminateFixture = join(root, 'terminate-owned-parent.exe');
  await compile(
    managedCompiler,
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/out:' + terminateFixture,
      resolve('native/windows-clipboard/fixture-descendant-terminate.cs'),
    ],
    'terminate-owned-parent',
  );
  const managedChildren = {},
    managedParents = {};
  for (const platform of ['x64', 'x86', 'anycpu', 'anycpu32bitpreferred']) {
    const image = join(root, 'managed-child-' + platform + '.exe');
    await compile(
      managedCompiler,
      [
        '/nologo',
        '/target:exe',
        '/platform:' + platform,
        '/out:' + image,
        '/r:System.Web.Extensions.dll',
        resolve('native/windows-clipboard/fixture-early-managed.cs'),
      ],
      'managed-child-' + platform,
    );
    managedChildren[platform] = image;
  }
  for (const platform of ['x64', 'x86']) {
    const image = join(root, 'managed-parent-' + platform + '.exe');
    await compile(
      managedCompiler,
      [
        '/nologo',
        '/target:exe',
        '/platform:' + platform,
        '/out:' + image,
        '/r:System.Web.Extensions.dll',
        resolve('native/windows-clipboard/fixture-descendant-managed.cs'),
      ],
      'managed-parent-' + platform,
    );
    managedParents[platform] = image;
  }
  const station = await channel();
  holding = spawn(holder, ['--launch', station.pipe], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  holding.stdout.resume();
  holding.once('close', (code, signal) => {
    holderClose = { code, signal, relayPid: holding.pid, at: new Date().toISOString() };
  });
  let holderErrors = '';
  holding.stderr.on('data', (chunk) => {
    holderErrors += chunk;
  });
  stationIdentity = await station.next();
  proof.station = stationIdentity;
  assert.notEqual(stationIdentity.station.toLowerCase(), 'winsta0');
  service = new NativeClipboard(options);
  await service.init();
  const applications = await Promise.all(
    [...Object.values(nativeParents), ...Object.values(managedParents)].map(async (image) => ({
      image,
      sha256: hash(await readFile(image)),
      rule: { copy: false, paste: false, files: false, sensitive: true, maxTextBytes: 1048576 },
    })),
  );
  await service.action({
    action: 'configure',
    version: service.view().version,
    settings: { enabled: true, applications },
  });
  const parent64 = await parentLaunch(nativeParents[64]),
    parent32 = await parentLaunch(nativeParents[32]);
  brokerGate = gatePoint('broker');
  const beforeBroker = childSpawn(parent64, nativeParents[64], 'parent');
  const reservedRequest = await brokerGate.ready;
  const reservedState = await actualStatus(reservedRequest.process);
  assert.equal(reservedState.present, false);
  assert.equal(reservedState.reserved, true);
  let ordinaryRefusal;
  await assert.rejects(ordinaryApply(reservedRequest.process), (error) => {
    ordinaryRefusal = error.message;
    return error.message.includes('controlled child creation is pending');
  });
  assert.equal(
    (await actualStatus(reservedRequest.process)).present,
    false,
    'ordinary apply cannot create even a policy mapping before broker adoption',
  );
  const beforeBrokerCalls = nativeCalls.length;
  await service.action({ action: 'refresh' });
  assert.equal(scannedApplies(reservedRequest.process, beforeBrokerCalls), 0);
  assert.equal(
    JSON.parse(await readFile(file, 'utf8')).managed.some((item) => same(item, reservedRequest.process)),
    false,
  );
  brokerGate.release();
  brokerGate = undefined;
  const reservedChild = await beforeBroker;
  const reservedProof = await sameExeParent(reservedChild, parent64);
  const reservedGrandchild = await childSpawn(reservedProof.parent, nativeChildren[32]);
  proof.cases.push({
    kind: 'pre-broker-native-Job-reservation',
    process: reservedRequest.process,
    pendingState: reservedState,
    ordinaryApplyRefusal: ordinaryRefusal,
    scannerApplies: 0,
    entryEvidence: reservedProof.entry,
    inheritance: reservedProof.inheritance,
    committedState: reservedProof.state,
    protectedGrandchild: await verifyChild(
      reservedGrandchild,
      reservedProof.parent,
      'native',
      parent64.process,
    ),
  });

  scanGate = gatePoint('list');
  const staleScan = service.action({ action: 'refresh' });
  const staleSnapshot = await scanGate.ready;
  adoptionGate = gatePoint('prepared');
  const lateChild = childSpawn(parent64, nativeChildren[32]);
  const lateIdentity = await adoptionGate.ready;
  assert.equal(
    staleSnapshot.processes.some((item) => same(item, lateIdentity)),
    false,
  );
  const beforeLateScan = nativeCalls.length;
  scanGate.release();
  await staleScan;
  scanGate = undefined;
  assert.ok(
    JSON.parse(await readFile(file, 'utf8')).managed.some((item) => same(item, lateIdentity)),
    'a stale real list cannot retire newly prepared ownership',
  );
  assert.equal(scannedApplies(lateIdentity, beforeLateScan), 0);
  adoptionGate.release();
  adoptionGate = undefined;
  proof.cases.push({
    kind: 'scan-list-snapshot-before-prepared',
    scannerApplies: 0,
    ...(await verifyChild(await lateChild, parent64)),
  });

  for (const phase of ['prepared', 'attached']) {
    adoptionGate = gatePoint(phase);
    const pending = childSpawn(parent64, nativeChildren[32]);
    const process = await adoptionGate.ready;
    assert.ok((await inventory()).some((item) => same(item, process)));
    const pendingState = await actualStatus(process);
    assert.equal(pendingState.present, phase === 'attached');
    assert.equal(pendingState.reserved, true);
    const beforeScan = nativeCalls.length;
    await service.action({ action: 'refresh' });
    assert.equal(scannedApplies(process, beforeScan), 0);
    assert.ok(JSON.parse(await readFile(file, 'utf8')).managed.some((item) => same(item, process)));
    adoptionGate.release();
    adoptionGate = undefined;
    proof.cases.push({
      kind: 'scan-inventory-during-' + phase,
      pendingState,
      scannerApplies: 0,
      ...(await verifyChild(await pending, parent64)),
    });
  }

  brokerGate = gatePoint('broker');
  const reverseChild = childSpawn(parent64, nativeParents[64], 'parent');
  const reverseRequest = await brokerGate.ready;
  scanGate = gatePoint('status');
  scanGate.pid = reverseRequest.process.pid;
  const reverseScan = service.action({ action: 'refresh' });
  const oldState = await scanGate.ready;
  assert.equal(oldState.reserved, true);
  adoptionGate = gatePoint('prepared');
  brokerGate.release();
  brokerGate = undefined;
  const reverseIdentity = await adoptionGate.ready;
  const beforeReverseScan = nativeCalls.length;
  scanGate.release();
  await reverseScan;
  scanGate = undefined;
  assert.equal(scannedApplies(reverseIdentity, beforeReverseScan), 0);
  adoptionGate.release();
  adoptionGate = undefined;
  const reverseProof = await sameExeParent(await reverseChild, parent64);
  proof.cases.push({
    kind: 'broker-preempts-scan-status',
    process: reverseIdentity,
    capturedPendingState: oldState,
    scannerApplies: 0,
    entryEvidence: reverseProof.entry,
    inheritance: reverseProof.inheritance,
    committedState: reverseProof.state,
  });

  const eofParent = await parentLaunch(nativeParents[64]);
  brokerGate = gatePoint('broker');
  const eofMarker = join(root, 'eof-unreachable-marker-' + randomUUID());
  const eofChild = childSpawn(eofParent, nativeChildren[32], 'native', 'W', true, eofMarker);
  void eofChild.catch(() => {});
  const eofRequest = await brokerGate.ready;
  assert.equal((await actualStatus(eofRequest.process)).reserved, true);
  const terminated = JSON.parse(
    (
      await execute(
        terminateFixture,
        [String(eofParent.process.pid), eofParent.process.created, eofParent.process.image],
        { windowsHide: true, timeout: 15000 },
      )
    ).stdout,
  );
  assert.equal(terminated.exactHandleVerified, true);
  assert.equal(terminated.pid, eofParent.process.pid);
  assert.equal(terminated.created, eofParent.process.created);
  await gone(eofParent.process);
  await gone(eofRequest.process);
  assert.equal(existsSync(eofMarker), false);
  assert.equal((await actualStatus(eofRequest.process)).present, false);
  await assert.rejects(eofChild, /fixture pipe closed/);
  brokerGate.release();
  brokerGate = undefined;
  const eofDeadline = Date.now() + 10000;
  while (
    Date.now() < eofDeadline &&
    !proof.channelErrors?.some((item) => item.message.includes('caller ended before authorization'))
  )
    await delay(20);
  assert.ok(proof.channelErrors?.some((item) => item.message.includes('caller ended before authorization')));
  assert.ok(
    (await inventory()).some((item) => same(item, parent32.process)),
    'EOF cleanup cannot affect another committed ancestor',
  );
  const eofWasNotJournaled = !JSON.parse(await readFile(file, 'utf8')).managed.some((item) =>
    same(item, eofRequest.process),
  );
  assert.equal(eofWasNotJournaled, true);
  proof.cases.push({
    kind: 'caller-EOF-before-service-adoption',
    parent: eofParent.process,
    process: eofRequest.process,
    termination: terminated,
    childGoneBeforeServiceAdoption: true,
    childWasNotJournaled: eofWasNotJournaled,
  });
  const childParentImage = join(root, '32', 'descendant-parent.exe');
  await copyFile(nativeParents[32], childParentImage);
  const intermediate = await childSpawn(parent64, childParentImage, 'parent');
  // childSpawn stores a distinct wrapper; remove that wrapper by its exact PID.
  const duplicate = children.findIndex((item) => same(item.process, intermediate.process));
  if (duplicate >= 0) children.splice(duplicate, 1);
  const middleEvidence = await intermediate.connection.next();
  assert.equal(middleEvidence.entryReady, true);
  const middle = {
    process: service.view().available.find((item) => same(item, intermediate.process)),
    connection: intermediate.connection,
  };
  assert.ok(middle.process);
  parents.push(middle);
  const grandchild = await childSpawn(middle, nativeChildren[64]);
  proof.cases.push({
    kind: 'actual-cross-exe-grandchild',
    middle: middle.process,
    ...(await verifyChild(grandchild, middle, 'native', parent64.process)),
  });
  const simultaneous = await Promise.all([
    childSpawn(parent64, nativeChildren[32]),
    childSpawn(parent32, nativeChildren[64]),
  ]);
  proof.cases.push({
    kind: 'concurrent-native-descendants',
    children: await Promise.all(
      simultaneous.map((item, index) => verifyChild(item, index ? parent32 : parent64)),
    ),
  });
  for (const [ancestor, image, mode] of [
    [parent64, nativeChildren[32], 'W'],
    [parent32, nativeChildren[64], 'A'],
    [parent64, nativeChildren[64], 'implicit'],
  ]) {
    const child = await childSpawn(ancestor, image, 'native', mode);
    assert.equal(child.process.suspension, 0);
    proof.cases.push({ kind: mode + '-cross-exe', ...(await verifyChild(child, ancestor)) });
    console.log(
      'Actual ' +
        ancestor.process.bits +
        '-bit CreateProcess ' +
        mode +
        ' child has ready policy in original DLL/TLS/Main.',
    );
  }
  const suspended = await childSpawn(parent64, nativeChildren[32], 'native', 'suspended');
  assert.equal(suspended.process.suspension, 1);
  await delay(200);
  assert.equal(suspended.connection.connected, false);
  const hotState = await ordinaryApply({ ...suspended.process, image: nativeChildren[32], bits: 32 }, 8192);
  assert.equal(hotState.ready, true);
  assert.equal(hotState.reserved, false);
  assert.equal(hotState.maximum, 8192);
  await service.action({ action: 'refresh' });
  const restoredSuspendedState = await actualStatus(suspended.process);
  assert.equal(restoredSuspendedState.maximum, 1048576);
  assert.equal(restoredSuspendedState.reserved, false);
  assert.equal(suspended.connection.connected, false);
  proof.cases.push({
    kind: 'committed-suspended-child-hot-update',
    process: suspended.process,
    hotState,
    restoredState: restoredSuspendedState,
  });
  parent64.connection.write('resume\t' + suspended.process.pid + '\n');
  assert.equal((await parent64.connection.next()).resumed, 1);
  proof.cases.push({ kind: 'caller-CREATE_SUSPENDED', ...(await verifyChild(suspended, parent64)) });
  for (const [platform, image] of Object.entries(managedChildren)) {
    const child = await childSpawn(parent64, image, 'managed');
    proof.cases.push({ kind: 'CLR-child-' + platform, ...(await verifyChild(child, parent64, 'managed')) });
    console.log('Actual CLR ' + platform + ' descendant initializer and Main are protected.');
  }
  for (const phase of ['dll-tls', 'dll-main', 'exe-tls']) {
    const connection = await channel(),
      marker = join(root, phase + '-marker-' + randomUUID());
    const ancestor = await parentLaunch(nativeParents[64], {
      phase,
      image: nativeChildren[32],
      connection,
      marker,
      kind: 'native',
    });
    assert.equal(ancestor.evidence.initial.started, true);
    const child = { process: ancestor.evidence.initial, connection, marker };
    children.push(child);
    proof.cases.push({ kind: 'ancestor-' + phase, ...(await verifyChild(child, ancestor)) });
    console.log('Actual ancestor ' + phase + ' creates protected x86 descendant without startup deadlock.');
  }
  for (const [platform, image] of Object.entries(managedParents)) {
    const connection = await channel(),
      marker = join(root, platform + '-initializer-child-' + randomUUID());
    const ancestor = await parentLaunch(image, {
      phase: 'initializer',
      image: nativeChildren[platform === 'x64' ? 32 : 64],
      connection,
      marker,
      kind: 'native',
    });
    assert.equal(ancestor.evidence.initializerReady, true);
    const child = { process: ancestor.evidence.initial, connection, marker };
    children.push(child);
    proof.cases.push({ kind: 'CLR-ancestor-' + platform, ...(await verifyChild(child, ancestor)) });
    console.log(
      'Actual CLR ' +
        platform +
        ' Process.Start during type initialization creates protected cross-architecture child.',
    );
  }
  if (tokenMode) {
    for (const [ancestor, bits] of [
      [parent64, 64],
      [parent32, 32],
    ]) {
      ancestor.connection.write('token-source-check\n');
      const evidence = await ancestor.connection.next();
      for (const field of [
        'sourceHandleClosedStillPinned',
        'beforeCallRejected',
        'childCheckRejected',
        'restoredSnapshotRejected',
        'implicitChangedRejected',
      ])
        assert.equal(evidence[field], true);
      assert.notEqual(evidence.modifiedChanged, evidence.modifiedBefore);
      assert.notEqual(evidence.modifiedRestored, evidence.modifiedBefore);
      proof.cases.push({ kind: 'mutable-source-token-and-recycled-caller-handle-' + bits, evidence });
    }
    for (const [ancestor, image, mode] of [
      [parent64, nativeChildren[32], 'as-user-W'],
      [parent32, nativeChildren[64], 'as-user-A'],
      [parent64, nativeChildren[64], 'as-user-null'],
      [parent32, nativeChildren[32], 'as-user-restricted'],
      [parent64, nativeChildren[32], 'as-user-implicit'],
    ]) {
      const child = await childSpawn(ancestor, image, 'native', mode);
      assert.equal(child.process.suspension, 0);
      assert.equal(child.process.token.sameUser, true);
      assert.equal(child.process.token.type, 1);
      proof.cases.push({ kind: mode + '-protected-DLL-TLS-Main', ...(await verifyChild(child, ancestor)) });
    }
    for (const [ancestor, bits, mode] of [
      [parent64, 32, 'as-user-W'],
      [parent32, 64, 'as-user-A'],
    ]) {
      const child = await childSpawn(ancestor, tokenChildren[bits], 'token', mode);
      assert.equal(child.process.token.processInheritable, true);
      assert.equal(child.process.token.threadInheritable, true);
      proof.cases.push({
        kind: mode + '-preserves-literal-parameters-security-and-std-handles',
        ...(await verifyTokenParameters(child)),
      });
    }
    const paused = await childSpawn(parent64, nativeChildren[32], 'native', 'as-user-suspended');
    assert.equal(paused.process.suspension, 1);
    await delay(100);
    assert.equal(paused.connection.connected, false);
    const hot = await ordinaryApply({ ...paused.process, image: nativeChildren[32], bits: 32 }, 8192);
    assert.equal(hot.reserved, false);
    assert.equal(hot.maximum, 8192);
    await service.action({ action: 'refresh' });
    assert.equal((await actualStatus(paused.process)).maximum, 1048576);
    assert.equal(paused.connection.connected, false);
    parent64.connection.write('resume\t' + paused.process.pid + '\n');
    assert.equal((await parent64.connection.next()).resumed, 1);
    proof.cases.push({
      kind: 'AsUser-caller-suspension-and-committed-hot-update',
      hotState: hot,
      ...(await verifyChild(paused, parent64)),
    });

    brokerGate = gatePoint('broker');
    const reservedLaunch = childSpawn(parent64, nativeParents[64], 'parent', 'as-user-W');
    const request = await brokerGate.ready;
    const pendingState = await actualStatus(request.process);
    assert.equal(pendingState.present, false);
    assert.equal(pendingState.reserved, true);
    await assert.rejects(ordinaryApply(request.process), /controlled child creation is pending/);
    assert.equal((await actualStatus(request.process)).present, false);
    const offset = nativeCalls.length;
    await service.action({ action: 'refresh' });
    assert.equal(scannedApplies(request.process, offset), 0);
    assert.equal(
      JSON.parse(await readFile(file, 'utf8')).managed.some((item) => same(item, request.process)),
      false,
    );
    brokerGate.release();
    brokerGate = undefined;
    const committed = await sameExeParent(await reservedLaunch, parent64);
    const grandson = await childSpawn(committed.parent, nativeChildren[32], 'native', 'as-user-W');
    proof.cases.push({
      kind: 'AsUser-pre-broker-exact-Job-reservation-and-grandchild',
      pendingState,
      scannerApplies: 0,
      inheritance: committed.inheritance,
      protectedGrandchild: await verifyChild(grandson, committed.parent, 'native', parent64.process),
    });

    for (const [mode, error] of [
      ['as-user-invalid', 5],
      ['as-user-no-query', 5],
      ['as-user-impersonation', 5],
      ['as-user-null-impersonated', 5],
      ['as-user-null-anonymous', 5],
      ['as-user-extended', 50],
      ['with-token', 50],
      ['with-token-invalid', 5],
      ['with-token-no-query', 5],
      ['with-logon', 50],
    ]) {
      const child = await childSpawn(parent64, tokenChildren[32], 'token', mode, false);
      assert.equal(child.process.error, error);
      assert.equal(child.process.pid, 0);
      assert.equal(existsSync(child.marker), false);
      proof.cases.push({
        kind: 'active-' + mode + '-before-application-refusal',
        evidence: child.process,
        applicationMarkerAbsent: true,
      });
    }
    for (const phase of ['dll-tls', 'dll-main', 'exe-tls']) {
      const connection = await channel(),
        marker = join(root, 'as-user-' + phase + '-marker-' + randomUUID());
      const ancestor = await parentLaunch(nativeParents[64], {
        phase,
        image: nativeChildren[32],
        connection,
        marker,
        kind: 'native',
        api: 'as-user-W',
      });
      assert.equal(ancestor.evidence.initial.started, true);
      const child = { process: ancestor.evidence.initial, connection, marker };
      children.push(child);
      proof.cases.push({ kind: 'AsUser-ancestor-' + phase, ...(await verifyChild(child, ancestor)) });
    }
    for (const [platform, image] of Object.entries(managedChildren)) {
      const child = await childSpawn(parent64, image, 'managed', 'as-user-W');
      proof.cases.push({
        kind: 'AsUser-CLR-child-' + platform,
        ...(await verifyChild(child, parent64, 'managed')),
      });
    }
    const concurrent = await Promise.all([
      childSpawn(parent64, nativeChildren[32], 'native', 'as-user-W'),
      childSpawn(parent32, nativeChildren[64], 'native', 'as-user-A'),
    ]);
    proof.cases.push({
      kind: 'concurrent-AsUser-W-A-cross-architecture',
      children: await Promise.all(
        concurrent.map((item, index) => verifyChild(item, index ? parent32 : parent64)),
      ),
    });
    for (const stage of ['prepared', 'attached']) {
      fault = stage;
      const previous = JSON.parse(await readFile(file, 'utf8')).managed;
      const refused = await childSpawn(parent64, nativeChildren[32], 'native', 'as-user-W', false);
      fault = undefined;
      const created = JSON.parse(await readFile(file, 'utf8')).managed.find(
        (item) => !previous.some((before) => same(before, item)),
      );
      assert.ok(created);
      await gone(created);
      assert.equal(existsSync(refused.marker), stage === 'attached');
      assert.ok((await inventory()).some((item) => same(item, parent32.process)));
      proof.cases.push({
        kind: 'AsUser-failure-after-' + stage,
        process: created,
        evidence: refused.process,
      });
    }
    const endedParent = await parentLaunch(nativeParents[64]);
    brokerGate = gatePoint('broker');
    const unreachable = join(root, 'as-user-eof-marker-' + randomUUID());
    const pendingChild = childSpawn(
      endedParent,
      nativeChildren[32],
      'native',
      'as-user-W',
      true,
      unreachable,
    );
    void pendingChild.catch(() => {});
    const pending = await brokerGate.ready;
    assert.equal((await actualStatus(pending.process)).reserved, true);
    const termination = JSON.parse(
      (
        await execute(
          terminateFixture,
          [String(endedParent.process.pid), endedParent.process.created, endedParent.process.image],
          { windowsHide: true, timeout: 15000 },
        )
      ).stdout,
    );
    assert.equal(termination.exactHandleVerified, true);
    await gone(endedParent.process);
    await gone(pending.process);
    assert.equal((await actualStatus(pending.process)).present, false);
    assert.equal(existsSync(unreachable), false);
    await assert.rejects(pendingChild, /fixture pipe closed/);
    const beforeRejection = proof.channelErrors?.length || 0;
    brokerGate.release();
    brokerGate = undefined;
    const rejectionDeadline = Date.now() + 10000;
    while (
      Date.now() < rejectionDeadline &&
      !(proof.channelErrors || [])
        .slice(beforeRejection)
        .some((item) => item.message.includes('caller ended before authorization'))
    )
      await delay(20);
    assert.ok(
      (proof.channelErrors || [])
        .slice(beforeRejection)
        .some((item) => item.message.includes('caller ended before authorization')),
    );
    assert.equal(
      JSON.parse(await readFile(file, 'utf8')).managed.some((item) => same(item, pending.process)),
      false,
    );
    assert.ok((await inventory()).some((item) => same(item, parent32.process)));
    proof.cases.push({
      kind: 'AsUser-caller-EOF-before-service-adoption',
      parent: endedParent.process,
      process: pending.process,
      termination,
      childGoneBeforeServiceAdoption: true,
      childWasNotJournaled: true,
      applicationMarkerAbsent: true,
    });
  }
  const unsupported = await childSpawn(parent64, nativeChildren[32], 'native', 'extended', false);
  assert.equal(unsupported.process.error, 50);
  assert.equal(existsSync(unsupported.marker), false);
  proof.cases.push({ kind: 'explicit-STARTUPINFOEX-boundary', evidence: unsupported.process });
  const persistedBeforeFailure = await readFile(file);
  const movedOwnership = join(root, 'ownership-before-write-failure.json');
  await rename(file, movedOwnership);
  await mkdir(file);
  let writeFailure;
  try {
    writeFailure = await childSpawn(parent64, nativeChildren[32], 'native', 'W', false);
  } finally {
    await rmdir(file);
    await copyFile(movedOwnership, file);
  }
  assert.ok(latestPrepared);
  await gone(latestPrepared);
  assert.equal(existsSync(writeFailure.marker), false);
  assert.equal(hash(await readFile(file)), hash(persistedBeforeFailure));
  proof.cases.push({
    kind: 'durable-descendant-write-failure',
    process: latestPrepared,
    evidence: writeFailure.process,
    previousOwnershipSha256: hash(persistedBeforeFailure),
    preservedFile: movedOwnership,
  });
  for (const stage of ['prepared', 'attached']) {
    fault = stage;
    const prior = JSON.parse(await readFile(file, 'utf8')).managed;
    const failed = await childSpawn(parent64, nativeChildren[32], 'native', 'W', false);
    fault = undefined;
    const journal = JSON.parse(await readFile(file, 'utf8')).managed;
    const owned = journal.find((item) => !prior.some((previous) => same(item, previous)));
    assert.ok(owned);
    assert.equal(owned.inheritance.parent.pid, parent64.process.pid);
    await gone(owned);
    assert.equal(existsSync(failed.marker), stage === 'attached');
    assert.ok(
      (await inventory()).some((item) => same(item, parent32.process)),
      'unrelated committed ancestor remains alive',
    );
    proof.cases.push({ kind: 'failure-after-' + stage, process: owned, evidence: failed.process });
  }
  const before = await childSpawn(parent64, nativeChildren[32]);
  const beforeProof = await verifyChild(before, parent64);
  await service.close();
  service = new NativeClipboard(options);
  await service.init();
  assert.equal(service.view().processes.find((item) => same(item, before.process))?.state, 'enforced');
  const after = await childSpawn(parent64, nativeChildren[32]);
  proof.cases.push({
    kind: 'restart-old-parent-new-broker',
    previous: beforeProof,
    ...(await verifyChild(after, parent64)),
  });
  for (const [boundary, mode] of [
    ['configure', 'W'],
    ['close', 'W'],
    ...(tokenMode
      ? [
          ['configure', 'as-user-W'],
          ['close', 'as-user-W'],
        ]
      : []),
  ]) {
    fault = 'gate';
    aborted = false;
    let enteredResolve;
    const enteredPromise = new Promise((yes) => {
      enteredResolve = yes;
    });
    entered = enteredResolve;
    const pending = childSpawn(parent64, nativeChildren[32], 'native', mode, false);
    const prepared = await enteredPromise;
    if (boundary === 'configure')
      await service.action({
        action: 'configure',
        version: service.view().version,
        settings: {
          enabled: true,
          applications: service
            .view()
            .settings.applications.map((item) => ({ ...item, rule: { ...item.rule, maxTextBytes: 8192 } })),
        },
      });
    else await service.close();
    const response = await pending;
    assert.equal(aborted, true);
    await gone(prepared);
    assert.equal(existsSync(response.marker), false);
    proof.cases.push({
      kind: (mode === 'W' ? '' : 'AsUser-') + 'generation-' + boundary + '-while-prepared',
      process: prepared,
      evidence: response.process,
    });
    fault = undefined;
    entered = undefined;
    if (boundary === 'close') {
      service = new NativeClipboard(options);
      await service.init();
    }
  }
  const final = await childSpawn(parent64, nativeChildren[32]);
  proof.cases.push({ kind: 'after-generation-retirement', ...(await verifyChild(final, parent64)) });
  await service.action({
    action: 'configure',
    version: service.view().version,
    settings: { enabled: false, applications: [] },
  });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).managed.length, 0);
  proof.disableClearedAllOwnedProcesses = true;
  if (tokenMode) {
    const baseline = await bareParent(nativeParents[64]);
    for (const mode of ['as-user-invalid', 'as-user-no-query', 'as-user-impersonation', 'with-token']) {
      const original = await childSpawn(baseline, tokenChildren[32], 'token', mode, null);
      const disabled = await childSpawn(parent64, tokenChildren[32], 'token', mode, null);
      assert.equal(disabled.process.started, original.process.started);
      assert.equal(disabled.process.error, original.process.error);
      if (original.process.started) {
        await verifyTokenParameters(original, false, mode === 'with-token');
        await verifyTokenParameters(disabled, false, mode === 'with-token');
      } else {
        assert.equal(existsSync(original.marker), false);
        assert.equal(existsSync(disabled.marker), false);
      }
      proof.cases.push({
        kind: 'inactive-' + mode + '-preserves-original-Windows-result',
        original: original.process,
        disabled: disabled.process,
      });
    }
    const originalLogon = await childSpawn(baseline, tokenChildren[32], 'token', 'with-logon');
    const disabledLogon = await childSpawn(parent64, tokenChildren[32], 'token', 'with-logon');
    proof.cases.push({
      kind: 'inactive-WithLogon-preserves-original-parameters-and-local-identity',
      original: await verifyTokenParameters(originalLogon, false, true),
      disabled: await verifyTokenParameters(disabledLogon, false, true),
    });
    // Original bInheritHandles can keep this bare parent's Node stdio open in
    // its exact children. Settle those owned fixtures before awaiting close.
    for (const child of children.filter((item) => item.ancestor === baseline)) {
      child.connection.write('exit\n');
      await gone(child.process);
    }
    baseline.connection.write('exit\n');
    assert.equal((await baseline.close).code, 0);
    await legacyAssetsRoundtrip(nativeParents[64], nativeChildren[32]);
    await legacyAssetsRoundtrip(nativeParents[64], nativeChildren[32], 6);
  }
  proof.passed = true;
  console.log('Descendant ownership, exact cleanup, restart, generation retirement and disable passed.');
} catch (error) {
  proof.failure = { message: error.message, stack: error.stack };
  if (service) proof.failure.view = service.view();
  throw error;
} finally {
  for (const point of gates) point.release();
  await service?.close().catch((error) => {
    proof.cleanupError = error.message;
  });
  for (const item of children) item.connection.write('exit\n');
  for (const item of parents) item.connection.write('exit\n');
  for (const connection of channels) await connection.close().catch(() => {});
  if (holding && !holderClose)
    await Promise.race([new Promise((yes) => holding.once('close', yes)), delay(5000)]);
  if (holding) {
    proof.holderClose = holderClose || { relayPid: holding.pid, missingActualClose: true };
    if (!holderClose) {
      proof.passed = false;
      proof.cleanupError = 'owned station relay did not publish actual process/stdio close';
    }
  }
  proof.completedAt = new Date().toISOString();
  proof.sourceUnchanged = (
    await Promise.all(sourceFiles.map(async (file) => hash(await readFile(file)) === sourceSha256[file]))
  ).every(Boolean);
  if (!proof.sourceUnchanged) proof.passed = false;
  await writeFile(proofPath, JSON.stringify(proof, null, 2) + '\n');
  console.log('Descendant proof: ' + proofPath);
}
