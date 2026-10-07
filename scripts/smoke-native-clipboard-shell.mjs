/**
 * 模块职责：验证真实 Shell 子创建来源、暂停接纳和拒绝路径，并核对原参数、环境、目录与句柄语义。
 * Module: Verify real Shell child-creation provenance, suspended adoption and rejection while checking original parameters, environment, directory and handle semantics.
 * 设计思路：编译并驱动自有夹具，在私有 station、独立状态文件与精确出生身份范围内检查实际回执；本脚本会产生临时进程/资产，执行平台及编译器要求由入口校验定义。
 * Design: Compile/drive owned fixtures and check actual receipts within private stations, separate state files and exact process-birth identities. This script creates temporary processes/assets; entry checks define platform/compiler requirements.
 */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeClipboard, nativeLaunch, nativeCommand } from '../server/native-clipboard.ts';
import { nativeClipboardDescendants } from '../server/native-clipboard-descendants.ts';

assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');
const root = resolve(process.env.SAKURA_NATIVE_CLIPBOARD_TEST_BASE || '.data/native-clipboard-test-temp', 'shell-' + randomUUID());
await mkdir(root, { recursive: true });
process.env.TEMP = process.env.TMP = root;
console.log('Shell private fixture: ' + root);
const execute = promisify(execFile), /**
 * 中文功能：计算输入字节的 SHA-256，用于将配置和资产身份绑定到实际内容。
 * English: Compute SHA-256 over input bytes to bind configuration and asset identities to actual content.
 * 输入 / Inputs: bytes。
 * 结果：返回分支计算值（`createHash('sha256').update(bytes).digest('hex')`）。
 * Result: Return the branch-computed value (`createHash('sha256').update(bytes).digest('hex')`).
 * 协作入口 / Collaborators: `createHash('sha256').update(bytes).digest`, `createHash('sha256').update`, `createHash`.
 */
hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sources = [
  'native/windows-clipboard/protocol.h', 'native/windows-clipboard/early-import.h',
  'native/windows-clipboard/control-system.h', 'native/windows-clipboard/descendant.h',
  'native/windows-clipboard/descendant-reservation.h', 'native/windows-clipboard/descendant-token.h',
  'native/windows-clipboard/descendant-cleanup.h',
  'native/windows-clipboard/descendant-policy.h', 'native/windows-clipboard/descendant-controller.h',
  'native/windows-clipboard/shell-provenance.h', 'native/windows-clipboard/shell-policy.h',
  'native/windows-clipboard/early-policy.def', 'native/windows-clipboard/policy.cpp',
  'native/windows-clipboard/ole-text-stream.h',
  'native/windows-clipboard/controller.cpp', 'native/windows-clipboard/fixture.cpp',
  'native/windows-clipboard/fixture-shell.h', 'native/windows-clipboard/fixture-shell-call.h',
  'native/windows-clipboard/fixture-shell-dll.cpp', 'native/windows-clipboard/fixture-shell-child.cpp',
  'native/windows-clipboard/fixture-shell-parent.cpp', 'native/windows-clipboard/fixture-shell-as-invoker.manifest',
  'native/windows-clipboard/fixture-shell-provenance.cpp', 'native/windows-clipboard/fixture-descendant-terminate.cs',
  'server/native-clipboard.ts', 'server/native-clipboard-descendants.ts',
  'scripts/build-native-clipboard.mjs', 'scripts/smoke-native-clipboard-shell.mjs',
];
const sourceSha256 = Object.fromEntries(await Promise.all(sources.map(async (name) => [name, hash(await readFile(name))])));
const proof = {
  version: 1, kind: 'actual-shell-direct-exe-open-early-policy', passed: false,
  startedAt: new Date().toISOString(), sourceSha256, cases: [], brokerRequests: [],
  adoptionStages: [], channelClosures: [], channelErrors: [], clipboardApisCalled: false,
  interactiveClipboardAccessed: false, registryChanged: false, newAccountCreated: false,
};
const assets = join(root, 'assets'), file = join(root, 'native.json');
const channels = [], parents = [], children = [], gates = [], nativeCalls = [], bareFixtures = [];
let service, station, holder, holderClosure, fault, held, brokerHeld;
const rule = { copy: false, paste: false, files: false, sensitive: true, maxTextBytes: 8192 };
/**
 * 中文功能：同时比较 PID 和创建时间，区分原进程、PID 复用者与邻居。
 * English: Compare both PID and creation time to distinguish the original process from PID reuse and neighbors.
 * 输入 / Inputs: a; b。
 * 结果：返回分支计算值（`a.pid === b.pid && a.created === b.created`）。
 * Result: Return the branch-computed value (`a.pid === b.pid && a.created === b.created`).
 */
const same = (a, b) => a.pid === b.pid && a.created === b.created;
/**
 * 中文功能：创建可显式进入和释放的异步门闩，用于在创建或接纳边界安排状态变化。
 * English: Create an explicitly enterable/releasable asynchronous gate to arrange state changes at creation/adoption boundaries.
 * 输入 / Inputs: stage。
 * 结果：返回分支计算值（`point`）。
 * Result: Return the branch-computed value (`point`).
 * 协作入口 / Collaborators: `gates.push`.
 */
function gate(stage) {
  let enter, release;
  const point = { stage, ready: new Promise((yes) => { enter = yes; }), waiting: new Promise((yes) => { release = yes; }), /**
   * 中文功能：提交门闩进入证据，并沿本实现等待用例的放行信号。
   * English: Submit gate-entry evidence and follow this implementation in awaiting case release.
   * 输入 / Inputs: value。
   * 结果：返回分支计算值（`enter(value)`）。
   * Result: Return the branch-computed value (`enter(value)`).
   * 协作入口 / Collaborators: `enter`.
   */
  enter: (value) => enter(value), /**
   * 中文功能：完成预先保存的门闩 Promise，使等待创建流程继续。
   * English: Settle the retained gate Promise so a waiting creation flow can continue.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`release()`）。
   * Result: Return the branch-computed value (`release()`).
   * 协作入口 / Collaborators: `release`.
   */
  release: () => release() };
  gates.push(point); return point;
}
/**
 * 中文功能：建立本轮自有命名管道，解析夹具逐行 JSON 回执，暴露写入、等待与关闭入口。
 * English: Create an owned named pipe, parse line-delimited fixture JSON receipts, and expose write/wait/close operations.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`point`），以 Promise 交付。
 * Result: Return the branch-computed value (`point`) through a Promise.
 * 协作入口 / Collaborators: `randomUUID`, `createServer`, `server.on`, `channels.push`.
 */
async function channel() {
  const pipe = '\\\\.\\pipe\\SakuraShellFixture.' + randomUUID(), server = createServer();
  let socket, reader, ended = false;
  const queued = [], waiting = [];
  server.on('connection', (client) => {
    if (socket) { client.destroy(); return; }
    socket = client; reader = createInterface({ input: client });
    reader.on('line', (line) => { const value = JSON.parse(line); if (waiting.length) waiting.shift().resolve(value); else queued.push(value); });
    client.on('close', () => { ended = true; for (const item of waiting.splice(0)) item.reject(new Error('owned Shell fixture pipe closed')); });
    client.on('error', () => {});
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(pipe, yes); });
  const point = {
    pipe, /**
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
    next: () => queued.length ? Promise.resolve(queued.shift()) : ended ? Promise.reject(new Error('owned Shell fixture ended')) : new Promise((resolve, reject) => {
      const timer = setTimeout(() => { const index = waiting.indexOf(item); if (index >= 0) waiting.splice(index, 1); reject(new Error('owned Shell fixture timeout: ' + pipe)); }, 30000);
      const item = { /**
       * 中文功能：清除本等待者的超时定时器并完成其成功结果。
       * English: Clear this waiter's timeout and settle its successful result.
       * 输入 / Inputs: value。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `clearTimeout`, `resolve`.
       */
      resolve: (value) => { clearTimeout(timer); resolve(value); }, /**
       * 中文功能：清除本等待者的超时定时器并交付失败原因。
       * English: Clear this waiter's timeout and deliver its rejection reason.
       * 输入 / Inputs: error。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `clearTimeout`, `reject`.
       */
      reject: (error) => { clearTimeout(timer); reject(error); } }; waiting.push(item);
    }),
    /**
     * 中文功能：关闭本夹具拥有的进程、流或管道；具体等待期限和强制终止条件以本函数分支为准。
     * English: Close processes, streams or pipes owned by this fixture; its branches define wait deadlines and forced-termination conditions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `socket?.destroy`, `reader?.close`.
     */
    close: async () => { socket?.destroy(); reader?.close(); await new Promise((yes) => server.close(yes)); },
    /**
     * 中文功能：读取本管道是否已有连接，供入口未执行的断言观察。
     * English: Read whether this pipe has a connection for assertions that an entry did not execute.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`!!socket`）。
     * Result: Return the branch-computed value (`!!socket`).
     */
    get connected() { return !!socket; },
  };
  channels.push(point); return point;
}
const options = {
  file, assets, interval: 0,
  /**
   * 中文功能：调用真实原生控制器并保留本轮命令或回执记录，供后续生命周期断言使用。
   * English: Invoke the real native controller and retain command/receipt records for later lifecycle assertions.
   * 输入 / Inputs: helper; args。
   * 结果：返回分支计算值（`nativeCommand(helper, args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`nativeCommand(helper, args)`) through a Promise.
   * 协作入口 / Collaborators: `nativeCalls.push`, `nativeCommand`.
   */
  run: async (helper, args) => { nativeCalls.push([...args]); return nativeCommand(helper, args); },
  /**
   * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
   * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
   * 输入 / Inputs: helper; owner; receive; failed。
   * 结果：返回受控对象，公开字段包括 `alive, close`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `alive, close`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `nativeClipboardDescendants`.
   */
  descendants: async (helper, owner, receive, failed) => {
    const broker = await nativeClipboardDescendants(helper, owner, async (request, identity) => {
      const beforeAdoption = await nativeCommand(join(dirname(helper), 'sakura-clipboard-controller.exe'), ['status', owner, String(request.process.pid), request.process.created]);
      proof.brokerRequests.push({ request, broker: identity, beforeAdoption });
      const point = brokerHeld;
      if (point && !point.used) { point.used = true; point.enter(request); await point.waiting; }
      return receive(request, identity);
    }, (error) => { proof.channelErrors.push({ message: error.message, at: new Date().toISOString() }); failed(error); });
    return { /**
     * 中文功能：计算本轮原生验收的辅助值；输入与分支结果如下，供相邻创建或断言步骤使用。
     * English: Compute a helper value for this native smoke; inputs and branch results below serve adjacent creation/assertion steps.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`broker.alive`）。
     * Result: Return the branch-computed value (`broker.alive`).
     */
    get alive() { return broker.alive; }, /**
     * 中文功能：关闭本夹具拥有的进程、流或管道；具体等待期限和强制终止条件以本函数分支为准。
     * English: Close processes, streams or pipes owned by this fixture; its branches define wait deadlines and forced-termination conditions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `broker.close`, `assert.ok`, `proof.channelClosures.push`.
     * 检查边界 / Checked boundaries: `assert.ok(broker.closure)`.
     */
    close: async () => { await broker.close(); assert.ok(broker.closure); proof.channelClosures.push({ process: broker.process, ...broker.closure }); } };
  },
  /**
   * 中文功能：协调本脚本的真实 Windows 创建或附着阶段，返回下述回执供身份与策略断言核对。
   * English: Coordinate this script's real Windows creation/attachment stage, returning the receipt below for identity/policy assertions.
   * 输入 / Inputs: helper; args; hooks; signal。
   * 结果：返回分支计算值（`nativeLaunch(helper, args, { prepared: async (process) => { await hooks.prepared…`）。
   * Result: Return the branch-computed value (`nativeLaunch(helper, args, { prepared: async (process) => { await hooks.prepared…`).
   * 协作入口 / Collaborators: `nativeLaunch`.
   */
  launch: (helper, args, hooks, signal) => nativeLaunch(helper, args, {
    /**
     * 中文功能：协调本脚本的真实 Windows 创建或附着阶段，返回下述回执供身份与策略断言核对。
     * English: Coordinate this script's real Windows creation/attachment stage, returning the receipt below for identity/policy assertions.
     * 输入 / Inputs: process。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('owned Shell prepared-stage refusal')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `hooks.prepared`, `proof.adoptionStages.push`, `point.enter`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    prepared: async (process) => {
      await hooks.prepared(process); if (args[0] !== 'adopt') return;
      proof.adoptionStages.push({ stage: 'prepared', process });
      if (fault === 'prepared') throw new Error('owned Shell prepared-stage refusal');
      const point = held;
      if (point?.stage === 'prepared') {
        point.enter(process);
        await new Promise((yes, no) => { /**
         * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
         * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`no(new Error('owned Shell generation retired'))`）。
         * Result: Return the branch-computed value (`no(new Error('owned Shell generation retired'))`).
         * 协作入口 / Collaborators: `no`.
         */
        const stop = () => no(new Error('owned Shell generation retired')); if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true }); point.waiting.then(yes); });
      }
    },
    /**
     * 中文功能：协调本脚本的真实 Windows 创建或附着阶段，返回下述回执供身份与策略断言核对。
     * English: Coordinate this script's real Windows creation/attachment stage, returning the receipt below for identity/policy assertions.
     * 输入 / Inputs: process; state。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('owned Shell attached-stage refusal')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `hooks.attached`, `proof.adoptionStages.push`.
     */
    attached: async (process, state) => {
      await hooks.attached(process, state); if (args[0] !== 'adopt') return;
      proof.adoptionStages.push({ stage: 'attached', process, state });
      if (fault === 'attached') throw new Error('owned Shell attached-stage refusal');
    },
  }, signal),
};
const standardFiles = ['stdin', 'stdout', 'stderr'].map((name) => join(root, 'owned-standard-' + name + '-' + randomUUID()));
/**
 * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
 * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`standardFiles.map((name, index) => '--shell-' + ['stdin', 'stdout', 'stderr'][in…`）。
 * Result: Return the branch-computed value (`standardFiles.map((name, index) => '--shell-' + ['stdin', 'stdout', 'stderr'][in…`).
 * 协作入口 / Collaborators: `standardFiles.map`.
 */
const standardArgs = () => standardFiles.map((name, index) => '--shell-' + ['stdin', 'stdout', 'stderr'][index] + '=' + name);
/**
 * 中文功能：通过原生控制器读取实时进程清单，供精确 PID/出生时间断言使用。
 * English: Read live process inventory through the native controller for exact PID/birth-time assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`JSON.parse((await execute(join(assets, 'sakura-clipboard-controller.exe'), ['lis…`），以 Promise 交付。
 * Result: Return the branch-computed value (`JSON.parse((await execute(join(assets, 'sakura-clipboard-controller.exe'), ['lis…`) through a Promise.
 * 协作入口 / Collaborators: `JSON.parse`, `execute`, `join`.
 */
async function inventory() { return JSON.parse((await execute(join(assets, 'sakura-clipboard-controller.exe'), ['list'], { windowsHide: true, timeout: 10000 })).stdout).processes; }
/**
 * 中文功能：在限定时间内轮询原进程身份消失；匹配完整身份而不只依据 PID。
 * English: Poll within a fixed deadline for the original process identity to disappear, matching complete identity rather than only PID.
 * 输入 / Inputs: process。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 失败 / Failure: `new Error('owned exact process still alive: ' + JSON.stringify(process))`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `Date.now`, `(await inventory()).some`, `inventory`, `delay`.
 */
async function gone(process) {
  const until = Date.now() + 10000;
  while (Date.now() < until) { if (!(await inventory()).some((item) => same(item, process))) return; await delay(100); }
  throw new Error('owned exact process still alive: ' + JSON.stringify(process));
}
/**
 * 中文功能：读取持久状态文件中的 owner 标识，供原生控制器核对本服务的归属。
 * English: Read the owner identifier from persisted state for native-controller ownership checks.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`JSON.parse(await readFile(file, 'utf8')).owner`），以 Promise 交付。
 * Result: Return the branch-computed value (`JSON.parse(await readFile(file, 'utf8')).owner`) through a Promise.
 * 协作入口 / Collaborators: `JSON.parse`, `readFile`.
 */
async function owner() { return JSON.parse(await readFile(file, 'utf8')).owner; }
/**
 * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
 * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
 * 输入 / Inputs: text。
 * 结果：返回分支计算值（`'"' + text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'`）。
 * Result: Return the branch-computed value (`'"' + text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'`).
 * 协作入口 / Collaborators: `text.replace(/(\\*)"/g, '$1$1\\"').replace`, `text.replace`.
 */
function quote(text) { return '"' + text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'; }
/**
 * 中文功能：使用本轮选定编译器和固定构建选项生成自有夹具，供后续真实原生调用验收。
 * English: Build an owned fixture with the selected compiler and fixed build options for subsequent real native-call acceptance.
 * 输入 / Inputs: compiler; args; label。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 失败 / Failure: `error`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `execute`, `writeFile`, `join`, `String`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function compile(compiler, args, label) {
  try { const result = await execute(compiler, args, { windowsHide: true, timeout: 60000 }); await writeFile(join(root, label + '.compile.log'), result.stdout + result.stderr); }
  catch (error) { await writeFile(join(root, label + '.compile.log'), String(error.stdout || '') + String(error.stderr || '') + '\n' + error.message); throw error; }
}
/**
 * 中文功能：检查本轮真实原生回执和状态，以下断言摘录给出本函数具体核对的边界。
 * English: Check real native receipts/state from this run; assertion excerpts below identify the boundaries checked by this function.
 * 输入 / Inputs: image; com = 'sta'。
 * 结果：返回分支计算值（`parent`），以 Promise 交付。
 * Result: Return the branch-computed value (`parent`) through a Promise.
 * 协作入口 / Collaborators: `channel`, `service.view().settings.applications.find`, `service.view`, `service.action`.
 * 检查边界 / Checked boundaries: `assert.equal(entry.entryReady, true)`; `assert.equal(entry.active, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function parentLaunch(image, com = 'sta') {
  const point = await channel(), binding = service.view().settings.applications.find((item) => item.image === image);
  const result = await service.action({ action: 'launch', version: service.view().version, image, sha256: binding.sha256, args: ['--shell-station=' + station.station, '--shell-owner=' + await owner(), '--shell-pipe=' + point.pipe, '--shell-com=' + com, ...standardArgs()] });
  const entry = await point.next(); assert.equal(entry.entryReady, true); assert.equal(entry.active, true); assert.equal(entry.station, station.station); assert.equal(entry.comResult, 0);
  const parent = { process: result.process, socket: point, entry, com }; parents.push(parent); return parent;
}
/**
 * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
 * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
 * 输入 / Inputs: image。
 * 结果：返回受控对象，公开字段包括 `point, marker, firstMarker, literal, parameters, image`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `point, marker, firstMarker, literal, parameters, image`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `channel`, `join`, `randomUUID`, `['--shell-station=' + station.station, '--shell-owner=' + await owner(), '-…`.
 */
async function childSpec(image) {
  const point = await channel(), marker = join(root, 'main-' + randomUUID()), firstMarker = join(root, 'tls-' + randomUUID());
  const literal = 'empty space 中文 \\ trailing\\ "quoted"';
  const parameters = ['--shell-station=' + station.station, '--shell-owner=' + await owner(), '--shell-pipe=' + point.pipe, '--shell-marker=' + marker, '--shell-first-marker=' + firstMarker, '--shell-literal=' + literal, ''].map(quote).join(' ');
  return { point, marker, firstMarker, literal, parameters, image };
}
/**
 * 中文功能：让父夹具调用指定 Shell API，必要时在创建前修改边界条件，分别记录拒绝或接纳证据。
 * English: Ask the parent fixture to call the selected Shell API, optionally mutate boundary conditions before creation, and record rejection/adoption evidence.
 * 输入 / Inputs: parent; image; api; expected; mutate; spec。
 * 结果：返回分支计算值（`evidence / acceptChild(parent, image, result, evidence, spec, requestOffset, callOffset)`），以 Promise 交付。
 * Result: Return the branch-computed value (`evidence / acceptChild(parent, image, result, evidence, spec, requestOffset, callOffset)`) through a Promise.
 * 状态影响 / State effects: `spec`, `result`, `evidence.mainAbsent`, `evidence.firstAbsent`, `evidence.clientConnected`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `childSpec`, `parent.socket.write`, `['spawn', api, image, parameters, dirname(image)].join`, `dirname`.
 * 检查边界 / Checked boundaries: `assert.ok(mutate)`; `assert.equal(result.started, expected, api + ' must preserve an accurate Shell result')`.
 * 设计思路：在请求前截取 broker 与原生命令序列起点，拒绝时检查主入口标记和管道连接均未出现；成功转交 acceptChild 核对完整身份，保留 Shell 自身返回语义。
 * Design: Capture broker/native-call offsets before requesting. Rejection checks absence of entry markers and pipe connection; success delegates full identity checks to acceptChild while preserving Shell result semantics.
 */
async function spawnChild(parent, image, api, expected, mutate, spec) {
  spec ||= await childSpec(image);
  const { point, marker, firstMarker, literal, parameters } = spec;
  const requestOffset = proof.brokerRequests.length, callOffset = nativeCalls.length;
  parent.socket.write(['spawn', api, image, parameters, dirname(image)].join('\t') + '\n');
  let result = await parent.socket.next();
  if (result.beforeCreate) { assert.ok(mutate); await mutate(result); parent.socket.write('continue\n'); result = await parent.socket.next(); }
  const evidence = { api, caller: parent.process, com: parent.com, result, expectedImage: image, parameters, marker, firstMarker };
  assert.equal(result.started, expected, api + ' must preserve an accurate Shell result');
  if (!result.started) {
    await delay(100); evidence.mainAbsent = !existsSync(marker); evidence.firstAbsent = !existsSync(firstMarker); evidence.clientConnected = point.connected;
    assert.equal(evidence.mainAbsent, true); assert.equal(evidence.clientConnected, false);
    evidence.requests = proof.brokerRequests.slice(requestOffset); proof.cases.push(evidence); console.log(JSON.stringify({ api, bits: parent.process.bits, started: false, error: result.error })); return evidence;
  }
  return acceptChild(parent, image, result, evidence, spec, requestOffset, callOffset);
}
/**
 * 中文功能：核对 Shell 孩子的真实身份、原启动上下文与接纳记录，区分受管继承和普通未接纳创建。
 * English: Check a Shell child's actual identity, original startup context and adoption record, distinguishing managed inheritance from ordinary unadopted creation.
 * 输入 / Inputs: parent; image; result; evidence; spec; requestOffset; callOffset。
 * 结果：返回分支计算值（`evidence`），以 Promise 交付。
 * Result: Return the branch-computed value (`evidence`) through a Promise.
 * 状态影响 / State effects: `evidence.child`, `evidence.fixture`, `evidence.standardObjects`, `evidence.exactLiveIdentity`, `evidence.requests`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `point.next`, `children.push`, `assert.equal`, `child.image.toLowerCase`.
 * 检查边界 / Checked boundaries: `assert.equal(child.image.toLowerCase(), image.toLowerCase())`; `assert.equal(child.cwd.toLowerCase(), dirname(image).toLowerCase())`.
 * 设计思路：关联暂停创建请求、journal 与孩子各入口阶段，要求接纳先有预留且没有普通 apply 扫描；最终报告移除活管道/fixture 函数，仅保留可序列化进程证据。
 * Design: Correlate suspended creation requests, journal and child entry phases, requiring reservation before adoption and no ordinary apply scan. Remove live pipe/fixture functions from final receipts, retaining serializable process evidence.
 */
async function acceptChild(parent, image, result, evidence, spec, requestOffset, callOffset) {
  const { point, marker, firstMarker, literal } = spec;
  const child = await point.next(); evidence.child = child;
  const fixture = { process: child, socket: point, parent, com: 'sta' }; children.push(fixture); evidence.fixture = fixture;
  assert.equal(child.image.toLowerCase(), image.toLowerCase()); assert.equal(child.cwd.toLowerCase(), dirname(image).toLowerCase()); assert.equal(child.station, station.station);
  assert.equal(child.argv.at(-1), ''); assert.equal(child.argv.at(-2), '--shell-literal=' + literal);
  assert.equal(child.environment, 'space 中文 \\ trailing\\ "quote"');
  if (parent.entry?.standards) evidence.standardObjects = child.standards.map((item, index) => JSON.stringify(item) === JSON.stringify(parent.entry.standards[index]));
  for (const phase of child.phases) { assert.equal(phase.pid, child.pid); assert.equal(phase.created, child.created); assert.equal(phase.parentPid, parent.process.pid); assert.equal(phase.privateStation, true); }
  if (result.returnedProcess) { assert.equal(result.pid, child.pid); assert.equal(result.created, child.created); assert.equal(result.image.toLowerCase(), image.toLowerCase()); }
  evidence.exactLiveIdentity = (await inventory()).find((item) => same(item, child)); assert.ok(evidence.exactLiveIdentity);
  evidence.requests = proof.brokerRequests.slice(requestOffset).filter((item) => same(item.request.process, child));
  evidence.journal = JSON.parse(await readFile(file, 'utf8')).managed.find((item) => same(item, child)) || null;
  evidence.ordinaryApplyCount = nativeCalls.slice(callOffset).filter((args) => args[0] === 'apply' && args[2] === String(child.pid) && args[3] === child.created).length;
  assert.equal(evidence.ordinaryApplyCount, 0);
  if (evidence.requests.length) {
    assert.equal(evidence.requests.length, 1); assert.equal(evidence.requests[0].beforeAdoption.present, false); assert.equal(evidence.requests[0].beforeAdoption.reserved, true);
    assert.equal(evidence.requests[0].request.suspended, true, 'Shell internal CREATE_SUSPENDED belongs to Shell');
    for (const phase of child.phases) { assert.equal(phase.ready, true); assert.equal(phase.active, true); assert.equal(phase.build, true); assert.equal(phase.flags, 8); assert.equal(phase.anyJob, true); }
    assert.ok(evidence.journal); assert.equal(evidence.journal.inheritance.parent.pid, parent.process.pid); assert.equal(evidence.journal.inheritance.parent.created, parent.process.created);
    for (const creation of result.systemCreation) { assert.equal(creation.thread, result.thread); assert.equal(creation.suspendedBeforeShellResume, 1); assert.equal(creation.startupPreserved, true); }
  } else { assert.equal(evidence.journal, null); for (const phase of child.phases) { assert.equal(phase.ready, false); assert.equal(phase.creationReserved, false); } }
  parent.socket.write(['track', String(child.pid), child.created, image].join('\t') + '\n'); assert.equal((await parent.socket.next()).tracked, true);
  // Store process evidence, never the live pipe/socket functions.
  const receipt = { ...evidence }; delete receipt.fixture;
  proof.cases.push(receipt); console.log(JSON.stringify({ api: evidence.api, bits: parent.process.bits, started: true, childBits: child.bits, phases: child.phases.map((item) => item.ready), adopted: !!evidence.journal })); return evidence;
}
/**
 * 中文功能：执行本模块中下述具体协作步骤，准备或观察本轮原生验收所需材料。
 * English: Perform the concrete collaboration steps below to prepare or observe material required by this native smoke run.
 * 输入 / Inputs: image; args。
 * 结果：返回分支计算值（`owned`），以 Promise 交付。
 * Result: Return the branch-computed value (`owned`) through a Promise.
 * 协作入口 / Collaborators: `spawn`, `args.map`, `fixture.stdout.resume`, `fixture.stderr.resume`.
 */
async function bareLaunch(image, args) {
  const fixture = spawn(image, args.map(quote), { windowsHide: true, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'] });
  fixture.stdout.resume(); fixture.stderr.resume();
  const owned = { fixture, closed: new Promise((yes) => fixture.once('close', (code, signal) => { owned.closure = { pid: fixture.pid, code, signal, at: new Date().toISOString(), stdioClosed: true }; yes(owned.closure); })) };
  bareFixtures.push(owned); return owned;
}
try {
  await cp(resolve('.tools/native-clipboard'), assets, { recursive: true });
  const manifest = JSON.parse(await readFile(join(assets, 'native-clipboard.json'), 'utf8')); assert.equal(manifest.version, 8); proof.build = manifest.build; proof.assets = manifest.files;
  for (const item of manifest.files) assert.equal(hash(await readFile(join(assets, item.name))), item.sha256);
  const snapshot = join(root, 'source-snapshot'); await cp(resolve('native/windows-clipboard'), join(snapshot, 'native/windows-clipboard'), { recursive: true });
  const include = join(snapshot, 'native/windows-clipboard');
  const common = ['-std=c++17', '-O2', '-s', '-static', '-Wl,--no-insert-timestamp', '-I' + include, '-DSAKURA_CLIPBOARD_BUILD="' + manifest.build + '"'];
  const compilers = { 64: process.env.SAKURA_NATIVE_CLIPBOARD_CXX || 'g++.exe', 32: process.env.SAKURA_NATIVE_CLIPBOARD_CXX32 || resolve('.tools/mingw32-16.2.0/mingw32/bin/g++.exe') }, images = {};
  for (const bits of [64, 32]) {
    const folder = join(root, String(bits)); await mkdir(folder);
    const library = join(folder, 'libShellFixture.a'), child = join(folder, 'shell-child-' + randomUUID() + '.exe'), parent = join(folder, 'shell-parent.exe'), model = join(folder, 'shell-provenance.exe');
    const resource = join(folder, 'as-invoker.rc'), object = join(folder, 'as-invoker.o');
    await writeFile(resource, '1 24 ' + JSON.stringify(join(include, 'fixture-shell-as-invoker.manifest')) + '\n');
    await compile(compilers[bits].replace(/g\+\+\.exe$/, 'windres.exe'), [resource, '-O', 'coff', '-o', object], 'resource-' + bits);
    await compile(compilers[bits], [...common, '-shared', '-Wl,--out-implib,' + library, join(include, 'fixture-shell-dll.cpp'), '-o', join(folder, 'ShellEarlyProbe.dll'), '-ladvapi32', '-lole32'], 'shell-dll-' + bits);
    await compile(compilers[bits], [...common, '-municode', join(include, 'fixture-shell-child.cpp'), library, object, '-o', child, '-ladvapi32', '-lole32', '-lshell32'], 'shell-child-' + bits);
    await compile(compilers[bits], [...common, '-municode', join(include, 'fixture-shell-parent.cpp'), object, '-o', parent, '-ladvapi32', '-lole32', '-lshell32'], 'shell-parent-' + bits);
    await compile(compilers[bits], [...common, '-municode', join(include, 'fixture-shell-provenance.cpp'), object, '-o', model, '-ladvapi32', '-lole32', '-lshell32'], 'shell-provenance-' + bits);
    const unsupported = [];
    for (const activation of ['no-manifest', 'require-administrator', 'ui-access']) {
      const unsupportedImage = join(folder, activation + '-' + randomUUID() + '.exe'), extra = [];
      if (activation !== 'no-manifest') {
        const text = (await readFile(join(include, 'fixture-shell-as-invoker.manifest'), 'utf8')).replace('level="asInvoker"', 'level="' + (activation === 'require-administrator' ? 'requireAdministrator' : 'asInvoker') + '"').replace('uiAccess="false"', 'uiAccess="' + (activation === 'ui-access' ? 'true' : 'false') + '"');
        const manifestFile = join(folder, activation + '.manifest'), rc = join(folder, activation + '.rc'), resourceObject = join(folder, activation + '.o');
        await writeFile(manifestFile, text); await writeFile(rc, '1 24 ' + JSON.stringify(manifestFile) + '\n');
        await compile(compilers[bits].replace(/g\+\+\.exe$/, 'windres.exe'), [rc, '-O', 'coff', '-o', resourceObject], activation + '-resource-' + bits); extra.push(resourceObject);
      }
      await compile(compilers[bits], [...common, '-municode', join(include, 'fixture-shell-child.cpp'), library, ...extra, '-o', unsupportedImage, '-ladvapi32', '-lole32', '-lshell32'], activation + '-child-' + bits);
      unsupported.push({ activation, image: unsupportedImage });
    }
    for (const suffix of ['.manifest', '.local']) {
      const unsupportedImage = join(folder, 'external-activation-' + randomUUID() + '.exe'); await cp(child, unsupportedImage); await writeFile(unsupportedImage + suffix, 'Owned refusal fixture only.\n'); unsupported.push({ activation: 'external' + suffix, image: unsupportedImage });
    }
    images[bits] = { parent, child, model, unsupported };
  }
  const holderImage = join(root, 'station.exe'); await compile(compilers[64], [...common, '-municode', join(include, 'fixture.cpp'), '-o', holderImage, '-lole32', '-luuid', '-lshell32', '-ladvapi32'], 'station');
  const stationPipe = await channel(); holder = spawn(holderImage, ['--launch', stationPipe.pipe], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); holder.stdout.resume(); holder.stderr.resume(); holder.once('close', (code, signal) => { holderClosure = { code, signal, pid: holder.pid, at: new Date().toISOString() }; }); station = await stationPipe.next(); assert.notEqual(station.station.toLowerCase(), 'winsta0'); proof.station = station;
  for (const bits of [64, 32]) {
    const point = await channel(), marker = join(root, 'cleanup-model-' + randomUUID());
    const owned = await bareLaunch(images[bits].model, ['--shell-station=' + station.station, '--shell-pipe=' + point.pipe, '--shell-cleanup-marker=' + marker]);
    const evidence = await point.next(); assert.equal(evidence.passed, true); assert.equal(evidence.station, station.station); assert.ok(evidence.count >= 23); assert.equal(existsSync(marker), false);
    point.write('exit\n'); const close = await owned.closed; assert.equal(close.code, 0);
    proof.cases.push({ ...evidence, bits, actualClose: close, clipboardApisCalled: false });
  }
  const terminateImage = join(root, 'terminate-owned-parent.exe');
  await compile(join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:exe', '/platform:x64', '/out:' + terminateImage, join(include, 'fixture-descendant-terminate.cs')], 'terminate-owned-parent');
  service = new NativeClipboard(options); await service.init();
  const applications = await Promise.all([64, 32].map(async (bits) => ({ image: images[bits].parent, sha256: hash(await readFile(images[bits].parent)), rule })));
  await service.action({ action: 'configure', version: service.view().version, settings: { enabled: true, applications } });
  for (const bits of [64, 32]) for (const com of ['sta', 'mta']) {
    const parent = await parentLaunch(images[bits].parent, com), child = images[bits === 64 ? 32 : 64].child;
    for (const api of ['ExW:cold', 'ExA', 'W', 'A', 'ExW-no-handle', 'ExA-no-handle', 'ExW:reentry']) await spawnChild(parent, child, api, true);
    for (const api of ['ExW-default', 'ExA-default', 'ExW:runas', 'ExA:unknown-verb', 'ExW:null-verb', 'ExW:unsupported-flags', 'ExA:invalid-cb', 'ExW:cross-thread', 'ExW:plain-startup']) { const failed = await spawnChild(parent, child, api, false); assert.equal(failed.result.error, 50); assert.equal(failed.firstAbsent, true); assert.equal(failed.requests.length, 0); }
  }
  const parent = parents[0], child = images[32].child;
  {
    const image = join(root, '64', 'running-shell-parent-' + randomUUID() + '.exe'); await cp(images[64].parent, image);
    const point = await channel(), owned = await bareLaunch(image, ['--shell-station=' + station.station, '--shell-owner=' + await owner(), '--shell-pipe=' + point.pipe, '--shell-com=sta', ...standardArgs()]);
    const entry = await point.next(); assert.equal(entry.entryReady, false); assert.equal(entry.active, false);
    const ancestor = { process: { pid: entry.pid, created: entry.created, bits: 64, image }, socket: point, entry, com: 'sta', bare: owned }; parents.push(ancestor);
    applications.push({ image, sha256: hash(await readFile(image)), rule });
    await service.action({ action: 'configure', version: service.view().version, settings: { enabled: true, applications } });
    const attached = service.view().processes.find((item) => same(item, ancestor.process)); assert.equal(attached.state, 'enforced');
    for (const api of ['ExW', 'ExA', 'W', 'A', 'ExW-no-handle']) {
      const result = await spawnChild(ancestor, child, api, true); proof.cases.at(-1).ancestorAttachedAfterMain = true;
      assert.equal(result.journal.inheritance.application.image, image);
    }
  }
  for (const bits of [64, 32]) for (const unsupported of images[bits].unsupported) {
    const refusal = await spawnChild(parent, unsupported.image, 'ExW', false); assert.equal(refusal.result.error, 50); assert.equal(refusal.firstAbsent, true); assert.equal(refusal.requests.length, 0); proof.cases.at(-1).activation = unsupported.activation;
  }
  const inactiveScope = await spawnChild(parent, child, 'ExW:policy-off', false, async () => { await service.action({ action: 'configure', version: service.view().version, settings: { enabled: false, applications: [] } }); });
  assert.equal(inactiveScope.result.error, 5); assert.equal(inactiveScope.firstAbsent, true);
  await service.action({ action: 'configure', version: service.view().version, settings: { enabled: true, applications } });
  const changedScope = await spawnChild(parent, child, 'ExW:policy-change', false, async () => { await service.action({ action: 'configure', version: service.view().version, settings: { enabled: true, applications: applications.map((item) => ({ ...item, rule: { ...rule, maxTextBytes: 16384 } })) } }); });
  assert.equal(changedScope.result.error, 50); assert.equal(changedScope.firstAbsent, true);
  await service.action({ action: 'configure', version: service.view().version, settings: { enabled: true, applications } });
  for (const stage of ['prepared', 'attached']) { fault = stage; const failed = await spawnChild(parent, child, 'ExW', false); fault = undefined; assert.equal(failed.firstAbsent, stage === 'prepared'); assert.equal(failed.requests.length, 1); await gone(failed.requests[0].request.process); }
  for (const boundary of ['configure', 'close']) {
    held = gate('prepared'); const pending = spawnChild(parent, child, 'ExA', false); const prepared = await held.ready;
    if (boundary === 'configure') await service.action({ action: 'configure', version: service.view().version, settings: { enabled: true, applications: applications.map((item) => ({ ...item, rule: { ...rule, maxTextBytes: 16384 } })) } }); else await service.close();
    const failed = await pending; assert.equal(failed.firstAbsent, true); await gone(prepared); held.release(); held = undefined;
    if (boundary === 'close') { service = new NativeClipboard(options); await service.init(); }
    await service.action({ action: 'configure', version: service.view().version, settings: { enabled: true, applications } });
  }
  const recovered = await spawnChild(parent, child, 'ExW', true);
  const nested = await spawnChild(recovered.fixture, images[64].child, 'ExW', true);
  assert.equal(nested.journal.inheritance.application.image, parent.process.image);
  assert.equal(nested.journal.inheritance.parent.pid, recovered.child.pid);
  for (const ancestor of [parents[0], parents[2]]) {
    const specs = await Promise.all([childSpec(images[32].child), childSpec(images[64].child)]), requestOffset = proof.brokerRequests.length, callOffset = nativeCalls.length;
    ancestor.socket.write(['parallel', 'ExW', ...specs.flatMap((item) => [item.image, item.parameters, dirname(item.image)])].join('\t') + '\n');
    const results = (await ancestor.socket.next()).parallel; assert.equal(results.length, 2); assert.notEqual(results[0].thread, results[1].thread);
    for (let index = 0; index < results.length; ++index) {
      assert.equal(results[index].started, true); results[index].returnedProcess = true; results[index].image = specs[index].image;
      await acceptChild(ancestor, specs[index].image, results[index], { api: 'ExW-parallel-thread-' + index, caller: ancestor.process, result: results[index] }, specs[index], requestOffset, callOffset);
    }
  }
  {
    const selectedChild = { image: child, sha256: hash(await readFile(child)), rule: { ...rule, copy: true, paste: true, files: true, sensitive: false } };
    await service.action({ action: 'configure', version: service.view().version, settings: { enabled: true, applications: [...applications, selectedChild] } });
    const spec = await childSpec(child); brokerHeld = gate('request'); const pending = spawnChild(parent, child, 'ExW', true, undefined, spec), request = await brokerHeld.ready;
    assert.equal(existsSync(spec.firstMarker), false);
    await service.action({ action: 'refresh' });
    const before = await nativeCommand(join(assets, 'sakura-clipboard-controller.exe'), ['status', await owner(), String(request.process.pid), request.process.created]);
    assert.equal(before.present, false); assert.equal(before.reserved, true);
    const suffix = request.process.bits === 32 ? '-x86' : ''; let applyRefusal;
    try { await nativeCommand(join(assets, 'sakura-clipboard-controller' + suffix + '.exe'), ['apply', await owner(), String(request.process.pid), request.process.created, child, join(assets, 'SakuraClipboardPolicy' + suffix + '.dll'), '7', '8192', '1']); } catch (error) { applyRefusal = error.message; }
    assert.ok(applyRefusal); assert.equal(existsSync(spec.firstMarker), false);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).managed.some((item) => same(item, request.process)), false);
    brokerHeld.release(); brokerHeld = undefined; const adopted = await pending;
    assert.equal(adopted.journal.inheritance.application.image, parent.process.image);
    proof.cases.push({ kind: 'Shell-creation-reservation-blocks-scan-and-ordinary-injection-before-broker-adoption', process: request.process, before, applyRefusal, firstApplicationCodeAbsentWhileHeld: true, adoptedFlags: adopted.child.phases[0].flags });
    await service.action({ action: 'configure', version: service.view().version, settings: { enabled: true, applications } });
  }
  {
    const ancestor = await parentLaunch(images[64].parent), spec = await childSpec(child); brokerHeld = gate('request');
    ancestor.socket.write(['spawn', 'ExW', child, spec.parameters, dirname(child)].join('\t') + '\n');
    const request = await brokerHeld.ready; assert.equal(existsSync(spec.firstMarker), false);
    const terminated = JSON.parse((await execute(terminateImage, [String(ancestor.process.pid), ancestor.process.created, ancestor.process.image], { windowsHide: true, timeout: 10000 })).stdout);
    ancestor.intentionalTermination = terminated; assert.equal(terminated.exactHandleVerified, true); assert.equal(terminated.exitCode, 91);
    await gone(ancestor.process); await gone(request.process);
    assert.equal(existsSync(spec.firstMarker), false); assert.equal(existsSync(spec.marker), false); assert.equal(spec.point.connected, false);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).managed.some((item) => same(item, request.process)), false);
    proof.cases.push({ kind: 'Shell-parent-EOF-before-service-adoption-cleans-only-the-reserved-exact-child', caller: ancestor.process, process: request.process, terminated, beforeApplicationCode: true, beforeJournal: true, childGoneBeforeGateRelease: true });
    brokerHeld.release(); brokerHeld = undefined; await service.action({ action: 'refresh' });
  }
  const baselineImage = join(root, '64', 'bare-shell-parent-' + randomUUID() + '.exe'); await cp(images[64].parent, baselineImage);
  const baselinePipe = await channel(); const baselineOwned = await bareLaunch(baselineImage, ['--shell-station=' + station.station, '--shell-owner=' + await owner(), '--shell-pipe=' + baselinePipe.pipe, '--shell-com=sta', ...standardArgs()]);
  const baselineEntry = await baselinePipe.next(); assert.equal(baselineEntry.entryReady, false); assert.equal(baselineEntry.active, false); assert.equal(baselineEntry.station, station.station);
  const baseline = { process: { pid: baselineEntry.pid, created: baselineEntry.created, bits: 64, image: baselineImage }, socket: baselinePipe, entry: baselineEntry, com: 'sta', bare: baselineOwned }; parents.push(baseline);
  const apiBaselines = {};
  for (const api of ['ExW', 'ExA', 'W', 'A', 'ExW-default', 'ExW-no-handle', 'ExA:null-verb']) {
    const expected = await spawnChild(baseline, child, api, true); apiBaselines[api] = expected;
  }
  const standardReference = apiBaselines.ExW;
  assert.deepEqual(standardReference.standardObjects, recovered.standardObjects, 'active Job augmentation preserves original Shell standard-object semantics');
  await service.action({ action: 'configure', version: service.view().version, settings: { enabled: false, applications: [] } });
  for (const ancestor of parents.filter((item) => !item.intentionalTermination && !item.bare)) for (const api of ['ExW', 'ExA', 'W', 'A', 'ExW-default', 'ExW-no-handle', 'ExA:null-verb']) {
    const disabled = await spawnChild(ancestor, images[ancestor.process.bits === 64 ? 32 : 64].child, api, true);
    assert.equal(disabled.result.nativeLastError, apiBaselines[api].result.nativeLastError); assert.equal(disabled.result.returnedProcess, apiBaselines[api].result.returnedProcess);
    assert.deepEqual(disabled.standardObjects, apiBaselines[api].standardObjects);
  }
  const missing = await spawnChild(parent, join(root, 'missing-' + randomUUID() + '.exe'), 'ExW', false); assert.equal(missing.result.error, 2); assert.equal(missing.result.nativeLastError, 2);
  const baselineMissing = await spawnChild(baseline, join(root, 'missing-' + randomUUID() + '.exe'), 'ExW', false); assert.equal(missing.result.nativeLastError, baselineMissing.result.nativeLastError); assert.equal(missing.result.hInstApp, baselineMissing.result.hInstApp);
  proof.passed = true;
} catch (error) { proof.failure = { message: error.message, stack: error.stack }; throw error; }
finally {
  for (const point of gates) point.release();
  await service?.close().catch((error) => { proof.cleanupError = error.message; });
  for (const child of [...children].reverse()) if ((await inventory().catch(() => [])).some((item) => same(item, child.process))) {
    child.socket.write('exit\n');
    child.parent.socket.write(['wait', String(child.process.pid), child.process.created].join('\t') + '\n');
    try { child.actualExit = await child.parent.socket.next(); assert.equal(child.actualExit.exactHandle, true); assert.equal(child.actualExit.exitCode, 0); await gone(child.process); }
    catch (error) { proof.cleanupError = error.message; proof.passed = false; }
  }
  for (const parent of parents.filter((item) => !item.intentionalTermination)) parent.socket.write('exit\n');
  for (const parent of parents) await gone(parent.process).catch((error) => { proof.cleanupError = error.message; proof.passed = false; });
  for (const point of channels) await point.close().catch(() => {});
  if (holder && !holderClosure) await Promise.race([new Promise((yes) => holder.once('close', yes)), delay(10000)]);
  proof.holderClose = holderClosure || null; if (!holderClosure || holderClosure.code !== 0) proof.passed = false;
  proof.bareFixtureClosures = await Promise.all(bareFixtures.map((item) => item.closed));
  if (proof.bareFixtureClosures.some((item) => item.code !== 0 || !item.stdioClosed)) proof.passed = false;
  proof.ownedRemaining = (await inventory().catch(() => [])).filter((item) => item.image.toLowerCase().startsWith(root.toLowerCase() + '\\'));
  if (proof.ownedRemaining.length || proof.cleanupError) proof.passed = false;
  proof.childExits = children.map((item) => ({ process: { pid: item.process.pid, created: item.process.created }, actualExit: item.actualExit || null }));
  proof.sourceUnchanged = (await Promise.all(sources.map(async (name) => hash(await readFile(name)) === sourceSha256[name]))).every(Boolean); if (!proof.sourceUnchanged) proof.passed = false;
  proof.completedAt = new Date().toISOString(); await writeFile(join(root, 'shell-proof.json'), JSON.stringify(proof, null, 2) + '\n'); console.log('Shell proof: ' + join(root, 'shell-proof.json'));
}
assert.equal(proof.passed, true);
