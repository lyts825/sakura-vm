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
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = ['server/native-clipboard.ts', 'native/windows-clipboard/controller.cpp',
  'native/windows-clipboard/policy.cpp', 'native/windows-clipboard/protocol.h',
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
async function channel() {
  const name = 'SakuraManagedEarly.' + randomUUID(), pipe = '\\\\.\\pipe\\' + name;
  const server = createServer(); let socket, reader; const waiting = [], queued = [];
  server.on('connection', connection => {
    if (socket) { connection.destroy(); return; } socket = connection;
    reader = createInterface({ input: connection });
    reader.on('line', line => { const value = JSON.parse(line); if (waiting.length) waiting.shift()(value); else queued.push(value); });
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(pipe, yes); });
  return { name, pipe, write: text => socket?.write(text), next: async () => {
    if (queued.length) return queued.shift();
    let timer, receive;
    try { return await Promise.race([new Promise(yes => { receive = yes; waiting.push(receive); }),
      new Promise((_, no) => { timer = setTimeout(() => no(new Error('owned managed fixture response timeout')), 20000); })]); }
    finally { clearTimeout(timer); const index = waiting.indexOf(receive); if (index >= 0) waiting.splice(index, 1); }
  }, close: async () => { socket?.destroy(); reader?.close(); await new Promise(yes => server.close(yes)); } };
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
async function inventory(selectedAssets = assets) {
  return JSON.parse((await execute(join(selectedAssets, 'sakura-clipboard-controller.exe'), ['list'],
    { windowsHide: true, timeout: 10000 })).stdout).processes;
}
const same = (a, b) => a.pid === b.pid && a.created === b.created;
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
