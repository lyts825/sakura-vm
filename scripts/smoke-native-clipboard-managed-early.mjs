/**
 * 模块职责：构建并运行托管早期初始化夹具，记录私有 station、策略就绪与精确进程清理证据。
 * Module: Build/run managed early-initialization fixtures and record private-station, policy readiness and exact process-cleanup evidence.
 * 设计思路：编译并驱动自有夹具，在私有 station、独立状态文件与精确出生身份范围内检查实际回执；本脚本会产生临时进程/资产，执行平台及编译器要求由入口校验定义。
 * Design: Compile/drive owned fixtures and check actual receipts within private stations, separate state files and exact process-birth identities. This script creates temporary processes/assets; entry checks define platform/compiler requirements.
 */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeClipboard, clipboardExecutableBits } from '../server/native-clipboard.ts';

assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
const root = resolve('.data/native-clipboard-test-temp/managed-early-' + randomUUID());
await mkdir(root, { recursive: true });
process.env.TEMP = process.env.TMP = root;
/**
 * 中文功能：计算输入字节的 SHA-256，用于将配置和资产身份绑定到实际内容。
 * English: Compute SHA-256 over input bytes to bind configuration and asset identities to actual content.
 * 输入 / Inputs: bytes。
 * 结果：返回分支计算值（`createHash('sha256').update(bytes).digest('hex')`）。
 * Result: Return the branch-computed value (`createHash('sha256').update(bytes).digest('hex')`).
 * 协作入口 / Collaborators: `createHash('sha256').update(bytes).digest`, `createHash('sha256').update`, `createHash`.
 */
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = ['server/native-clipboard.ts', 'native/windows-clipboard/controller.cpp',
  'native/windows-clipboard/policy.cpp', 'native/windows-clipboard/protocol.h',
  'native/windows-clipboard/ole-text-stream.h',
  'native/windows-clipboard/early-import.h', 'native/windows-clipboard/control-system.h',
  'native/windows-clipboard/fixture.cpp', 'native/windows-clipboard/fixture-early-managed.cs',
  'scripts/build-native-clipboard.mjs', 'scripts/smoke-native-clipboard-managed-early.mjs'];
const sourceSha256 = Object.fromEntries(await Promise.all(sources.map(async file => [file, hash(await readFile(file))])));
const execute = promisify(execFile), assets = join(root, 'assets');
await cp(resolve('.tools/native-clipboard'), assets, { recursive: true });
const manifest = JSON.parse(await readFile(join(assets, 'native-clipboard.json'), 'utf8'));
const proof = { version: 1, kind: 'actual-managed-clipboard-early', passed: false, startedAt: new Date().toISOString(),
  sourceSha256, sourceUnchanged: false, build: manifest.build, assets: manifest.files, cases: [],
  interactiveClipboardAccessed: false, newAccountCreated: false, runtimeInstalled: false };
const file = join(root, 'native.json'), service = new NativeClipboard({ file, assets, interval: 0 });
/**
 * 中文功能：建立本轮自有命名管道，解析夹具逐行 JSON 回执，暴露写入、等待与关闭入口。
 * English: Create an owned named pipe, parse line-delimited fixture JSON receipts, and expose write/wait/close operations.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `name, pipe, write, next, close`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `name, pipe, write, next, close`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `createServer`, `server.on`.
 */
async function channel() {
  const name = 'SakuraManagedEarly.' + randomUUID(), pipe = '\\\\.\\pipe\\' + name;
  const server = createServer(); let socket, reader; const waiting = [], queued = [];
  server.on('connection', connection => {
    if (socket) { connection.destroy(); return; } socket = connection;
    reader = createInterface({ input: connection });
    reader.on('line', line => { const value = JSON.parse(line); if (waiting.length) waiting.shift()(value); else queued.push(value); });
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(pipe, yes); });
  return { name, pipe, /**
   * 中文功能：向当前夹具管道写入命令；连接未建立或已结束时按本表达式处理。
   * English: Write a command to the fixture pipe; this expression handles absent or ended connections.
   * 输入 / Inputs: text。
   * 结果：返回分支计算值（`socket?.write(text)`）。
   * Result: Return the branch-computed value (`socket?.write(text)`).
   * 协作入口 / Collaborators: `socket?.write`.
   */
  write: text => socket?.write(text), /**
   * 中文功能：优先取已排队回执，否则登记等待者；关闭或超时通过本分支的拒绝路径结束等待。
   * English: Consume a queued receipt first or register a waiter; the implemented closure/timeout rejection path ends pending waits.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`queued.shift() / await Promise.race([new Promise(yes => { receive = yes; waiting.push(receive); }…`），以 Promise 交付。
   * Result: Return the branch-computed value (`queued.shift() / await Promise.race([new Promise(yes => { receive = yes; waiting.push(receive); }…`) through a Promise.
   * 协作入口 / Collaborators: `queued.shift`, `Promise.race`, `clearTimeout`, `waiting.indexOf`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  next: async () => {
    if (queued.length) return queued.shift();
    let timer, receive;
    try { return await Promise.race([new Promise(yes => { receive = yes; waiting.push(receive); }),
      new Promise((_, no) => { timer = setTimeout(() => no(new Error('owned managed fixture response timeout')), 20000); })]); }
    finally { clearTimeout(timer); const index = waiting.indexOf(receive); if (index >= 0) waiting.splice(index, 1); }
  }, /**
   * 中文功能：关闭本夹具拥有的进程、流或管道；具体等待期限和强制终止条件以本函数分支为准。
   * English: Close processes, streams or pipes owned by this fixture; its branches define wait deadlines and forced-termination conditions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `socket?.destroy`, `reader?.close`.
   */
  close: async () => { socket?.destroy(); reader?.close(); await new Promise(yes => server.close(yes)); } };
}
const channels = [], processes = [];
const station = await channel(); channels.push(station);
const holder = join(root, 'station.exe');
await execute(process.env.SAKURA_NATIVE_CLIPBOARD_CXX || 'g++.exe', ['-std=c++17', '-O2', '-s', '-static', '-municode',
  resolve('native/windows-clipboard/fixture.cpp'), '-o', holder, '-lole32', '-luuid', '-lshell32', '-ladvapi32'],
  { windowsHide: true, timeout: 60000 });
const holding = spawn(holder, ['--launch', station.pipe], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let holderExit, holderClose; const holderErrors = [];
holding.stderr.on('data', chunk => holderErrors.push(chunk.toString())); holding.stdout.resume();
holding.once('exit', (code, signal) => { holderExit = { code, signal }; });
const holderClosed = new Promise(yes => holding.once('close', (code, signal) => { holderClose = { code, signal }; yes(); }));
const compiler = join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const variants = [['x64', 64], ['x86', 32], ['anycpu', 64], ['anycpu32bitpreferred', 32]];
/**
 * 中文功能：通过原生控制器读取实时进程清单，供精确 PID/出生时间断言使用。
 * English: Read live process inventory through the native controller for exact PID/birth-time assertions.
 * 输入 / Inputs: selectedAssets = assets。
 * 结果：返回分支计算值（`JSON.parse((await execute(join(selectedAssets, 'sakura-clipboard-controller.exe'…`），以 Promise 交付。
 * Result: Return the branch-computed value (`JSON.parse((await execute(join(selectedAssets, 'sakura-clipboard-controller.exe'…`) through a Promise.
 * 协作入口 / Collaborators: `JSON.parse`, `execute`, `join`.
 */
async function inventory(selectedAssets = assets) {
  return JSON.parse((await execute(join(selectedAssets, 'sakura-clipboard-controller.exe'), ['list'],
    { windowsHide: true, timeout: 10000 })).stdout).processes;
}
/**
 * 中文功能：同时比较 PID 和创建时间，区分原进程、PID 复用者与邻居。
 * English: Compare both PID and creation time to distinguish the original process from PID reuse and neighbors.
 * 输入 / Inputs: a; b。
 * 结果：返回分支计算值（`a.pid === b.pid && a.created === b.created`）。
 * Result: Return the branch-computed value (`a.pid === b.pid && a.created === b.created`).
 */
const same = (a, b) => a.pid === b.pid && a.created === b.created;
/**
 * 中文功能：在限定时间内轮询原进程身份消失，未消失时由断言拒绝验收。
 * English: Poll within a fixed deadline for the original process identity to disappear, failing acceptance through assertions if it remains.
 * 输入 / Inputs: process。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 失败 / Failure: `new Error('owned CLR fixture did not exit: ' + JSON.stringify(process))`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `Date.now`, `(await inventory()).some`, `inventory`, `delay`.
 */
async function awaitGone(process) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (!(await inventory()).some(item => same(item, process)))return; await delay(100); }
  throw new Error('owned CLR fixture did not exit: ' + JSON.stringify(process));
}
try {
  const identity = await station.next(); proof.station = identity.station;
  assert.notEqual(identity.station.toLowerCase(), 'winsta0'); await service.init();
  for (const [platform, bits] of variants) {
    const image = join(root, platform + '.exe');
    await execute(compiler, ['/nologo', '/target:exe', '/platform:' + platform, '/out:' + image,
      '/r:System.Web.Extensions.dll', resolve('native/windows-clipboard/fixture-early-managed.cs')],
      { windowsHide: true, timeout: 60000 });
    assert.equal(await clipboardExecutableBits(image), bits);
    const sha256 = hash(await readFile(image));
    await service.action({ action: 'configure', version: service.view().version, settings: { enabled: true,
      applications: [...service.view().settings.applications, { image, sha256,
        rule: { copy: false, paste: false, files: false, sensitive: true, maxTextBytes: 1048576 } }] } });
    const saved = JSON.parse(await readFile(file, 'utf8'));
    const connection = await channel(); channels.push(connection);
    const marker = join(root, platform + '-entered');
    const result = await service.action({ action: 'launch', version: service.view().version, image, sha256,
      args: ['--station=' + identity.station, '--owner=' + saved.owner, '--pipe=' + connection.name, '--marker=' + marker] });
    processes.push({ process: result.process, connection });
    const evidence = await connection.next();
    assert.equal(result.process.bits, bits); assert.equal(evidence.phases.length, 2); assert.equal(existsSync(marker), true);
    for (const [index, phase] of evidence.phases.entries()) {
      assert.equal(phase.phase, index ? 'main' : 'type-initializer');
      assert.equal(phase.pid, result.process.pid); assert.equal(phase.created, result.process.created);
      assert.equal(phase.bits, bits); assert.equal(phase.ready, true); assert.equal(phase.flags, 8);
      assert.equal(phase.privateStation, true); assert.equal(phase.copyError, 5); assert.equal(phase.pasteError, 5);
      assert.equal(phase.oleCopy, 0x80070005); assert.equal(phase.olePaste, 0x80070005);
      assert.equal(phase.copies, (index + 1) * 2); assert.equal(phase.pastes, (index + 1) * 2);
    }
    proof.cases.push({ platform, image, sha256, process: result.process, evidence });
    console.log(`Actual ${platform} (${bits}-bit) CLR initializer and main observe ready policy; Win32/OLE calls blocked.`);
  }
  // Compile an intentionally incompatible policy into owned test assets. A
  // manifest-only change does not change a DLL's embedded native build identity.
  const badAssets = join(root, 'refusal-assets'); await cp(assets, badAssets, { recursive: true });
  const native = resolve('native/windows-clipboard'), detours = join(native, 'vendor/detours/src'), minhook = join(native, 'vendor/minhook/src');
  await execute(process.env.SAKURA_NATIVE_CLIPBOARD_CXX || 'g++.exe', ['-std=c++17', '-O2', '-s', '-static',
    '-D__CRT__NO_INLINE', `-DSAKURA_CLIPBOARD_BUILD="${'f'.repeat(64)}"`, '-shared', '-Wl,--kill-at',
    join(native, 'policy.cpp'), join(native, 'early-policy.def'),
    ...['detours.cpp', 'modules.cpp', 'disasm.cpp', 'image.cpp', 'creatwth.cpp'].map(file => join(detours, file)),
    ...['buffer.c', 'hook.c', 'trampoline.c', 'hde/hde64.c'].map(file => join(minhook, file)),
    '-o', join(badAssets, 'SakuraClipboardPolicy.dll'), '-luser32', '-lcomctl32', '-lole32', '-luuid'],
    { windowsHide: true, timeout: 60000 });
  const incompatible = JSON.parse(await readFile(join(badAssets, 'native-clipboard.json'), 'utf8'));
  const policyBytes = await readFile(join(badAssets, 'SakuraClipboardPolicy.dll'));
  Object.assign(incompatible.files.find(file => file.name === 'SakuraClipboardPolicy.dll'),
    { size: policyBytes.length, sha256: hash(policyBytes) });
  await writeFile(join(badAssets, 'native-clipboard.json'), JSON.stringify(incompatible));
  const badFile = join(root, 'refusal-native.json'), refused = new NativeClipboard({ file: badFile, assets: badAssets, interval: 0 });
  try {
    await refused.init(); const original = proof.cases.find(item => item.platform === 'anycpu');
    // A separate image prevents this enabled service from discovering and
    // attaching the already committed neighbor with the same executable path.
    const refusedImage = join(root, 'refused-anycpu.exe');
    await cp(original.image, refusedImage);
    await refused.action({ action: 'configure', version: refused.view().version, settings: { enabled: true,
      applications: [{ image: refusedImage, sha256: original.sha256,
        rule: { copy: false, paste: false, files: false, sensitive: true, maxTextBytes: 1048576 } }] } });
    const saved = JSON.parse(await readFile(badFile, 'utf8')), marker = join(root, 'must-not-enter-refused-clr');
    let reason;
    await assert.rejects(refused.action({ action: 'launch', version: refused.view().version, image: refusedImage,
      sha256: original.sha256, args: ['--station=' + identity.station, '--owner=' + saved.owner,
        '--pipe=' + station.name, '--marker=' + marker] }), error => { reason = error.message; return /initializ|初始化|modules unavailable/.test(reason); });
    assert.equal(existsSync(marker), false);
    const owned = JSON.parse(await readFile(badFile, 'utf8')).managed; assert.equal(owned.length, 1);
    await awaitGone(owned[0]); const live = await inventory();
    for (const row of processes) assert.ok(live.some(item => same(item, row.process)), 'committed neighbors preserved');
    await refused.action({ action: 'refresh' }); assert.equal(JSON.parse(await readFile(badFile, 'utf8')).managed.length, 0);
    proof.refusal = { reason, process: owned[0], initializerNeverEntered: true, journalRetainedUntilRefresh: true,
      exactChildGone: true, committedNeighborsPreserved: true };
  } finally { await refused.close(); }
  for (const row of processes) { row.connection.write('exit\n'); await awaitGone(row.process); }
  await service.action({ action: 'refresh' }); assert.equal(JSON.parse(await readFile(file, 'utf8')).managed.length, 0);
  proof.ownedManagedRemaining = 0; proof.passed = true;
} catch (error) { proof.error = String(error); process.exitCode = 1; }
finally {
  for (const row of processes) row.connection.write('exit\n');
  station.write('exit\n'); await service.close();
  for (const row of processes) await awaitGone(row.process).catch(error => { proof.passed = false; proof.cleanupError = String(error); process.exitCode = 1; });
  await Promise.all(channels.map(connection => connection.close()));
  const limit = setTimeout(() => holding.kill(), 10000);
  try { await holderClosed; } finally { clearTimeout(limit); }
  proof.holder = { actualExit: holderExit, actualClose: holderClose, stdoutClosed: holding.stdout.closed,
    stderrClosed: holding.stderr.closed, errors: holderErrors.join('') };
  if (holderExit?.code !== 0 || holderClose?.code !== 0 || !holding.stdout.closed || !holding.stderr.closed) {
    proof.passed = false; process.exitCode = 1;
  }
  for (const [file, digest] of Object.entries(sourceSha256)) assert.equal(hash(await readFile(file)), digest, file);
  proof.sourceUnchanged = true; proof.finishedAt = new Date().toISOString();
  const proofFile = join(root, 'verification.json'); await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ proofFile, passed: proof.passed, cases: proof.cases.length, error: proof.error }));
}
