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
const execute = promisify(execFile), hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sources = [
  'native/windows-clipboard/protocol.h', 'native/windows-clipboard/early-import.h',
  'native/windows-clipboard/control-system.h', 'native/windows-clipboard/descendant.h',
  'native/windows-clipboard/descendant-reservation.h', 'native/windows-clipboard/descendant-token.h',
  'native/windows-clipboard/descendant-cleanup.h',
  'native/windows-clipboard/descendant-policy.h', 'native/windows-clipboard/descendant-controller.h',
  'native/windows-clipboard/shell-provenance.h', 'native/windows-clipboard/shell-policy.h',
  'native/windows-clipboard/early-policy.def', 'native/windows-clipboard/policy.cpp',
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
const same = (a, b) => a.pid === b.pid && a.created === b.created;
function gate(stage) {
  let enter, release;
  const point = { stage, ready: new Promise((yes) => { enter = yes; }), waiting: new Promise((yes) => { release = yes; }), enter: (value) => enter(value), release: () => release() };
  gates.push(point); return point;
}
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
    pipe, write: (text) => !ended && socket?.write(text),
    next: () => queued.length ? Promise.resolve(queued.shift()) : ended ? Promise.reject(new Error('owned Shell fixture ended')) : new Promise((resolve, reject) => {
      const timer = setTimeout(() => { const index = waiting.indexOf(item); if (index >= 0) waiting.splice(index, 1); reject(new Error('owned Shell fixture timeout: ' + pipe)); }, 30000);
      const item = { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } }; waiting.push(item);
    }),
    close: async () => { socket?.destroy(); reader?.close(); await new Promise((yes) => server.close(yes)); },
    get connected() { return !!socket; },
  };
  channels.push(point); return point;
}
const options = {
  file, assets, interval: 0,
  run: async (helper, args) => { nativeCalls.push([...args]); return nativeCommand(helper, args); },
  descendants: async (helper, owner, receive, failed) => {
    const broker = await nativeClipboardDescendants(helper, owner, async (request, identity) => {
      const beforeAdoption = await nativeCommand(join(dirname(helper), 'sakura-clipboard-controller.exe'), ['status', owner, String(request.process.pid), request.process.created]);
      proof.brokerRequests.push({ request, broker: identity, beforeAdoption });
      const point = brokerHeld;
      if (point && !point.used) { point.used = true; point.enter(request); await point.waiting; }
      return receive(request, identity);
    }, (error) => { proof.channelErrors.push({ message: error.message, at: new Date().toISOString() }); failed(error); });
    return { get alive() { return broker.alive; }, close: async () => { await broker.close(); assert.ok(broker.closure); proof.channelClosures.push({ process: broker.process, ...broker.closure }); } };
  },
  launch: (helper, args, hooks, signal) => nativeLaunch(helper, args, {
    prepared: async (process) => {
      await hooks.prepared(process); if (args[0] !== 'adopt') return;
      proof.adoptionStages.push({ stage: 'prepared', process });
      if (fault === 'prepared') throw new Error('owned Shell prepared-stage refusal');
      const point = held;
      if (point?.stage === 'prepared') {
        point.enter(process);
        await new Promise((yes, no) => { const stop = () => no(new Error('owned Shell generation retired')); if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true }); point.waiting.then(yes); });
      }
    },
    attached: async (process, state) => {
      await hooks.attached(process, state); if (args[0] !== 'adopt') return;
      proof.adoptionStages.push({ stage: 'attached', process, state });
      if (fault === 'attached') throw new Error('owned Shell attached-stage refusal');
    },
  }, signal),
};
const standardFiles = ['stdin', 'stdout', 'stderr'].map((name) => join(root, 'owned-standard-' + name + '-' + randomUUID()));
const standardArgs = () => standardFiles.map((name, index) => '--shell-' + ['stdin', 'stdout', 'stderr'][index] + '=' + name);
async function inventory() { return JSON.parse((await execute(join(assets, 'sakura-clipboard-controller.exe'), ['list'], { windowsHide: true, timeout: 10000 })).stdout).processes; }
async function gone(process) {
  const until = Date.now() + 10000;
  while (Date.now() < until) { if (!(await inventory()).some((item) => same(item, process))) return; await delay(100); }
  throw new Error('owned exact process still alive: ' + JSON.stringify(process));
}
async function owner() { return JSON.parse(await readFile(file, 'utf8')).owner; }
function quote(text) { return '"' + text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'; }
async function compile(compiler, args, label) {
  try { const result = await execute(compiler, args, { windowsHide: true, timeout: 60000 }); await writeFile(join(root, label + '.compile.log'), result.stdout + result.stderr); }
  catch (error) { await writeFile(join(root, label + '.compile.log'), String(error.stdout || '') + String(error.stderr || '') + '\n' + error.message); throw error; }
}
async function parentLaunch(image, com = 'sta') {
  const point = await channel(), binding = service.view().settings.applications.find((item) => item.image === image);
  const result = await service.action({ action: 'launch', version: service.view().version, image, sha256: binding.sha256, args: ['--shell-station=' + station.station, '--shell-owner=' + await owner(), '--shell-pipe=' + point.pipe, '--shell-com=' + com, ...standardArgs()] });
  const entry = await point.next(); assert.equal(entry.entryReady, true); assert.equal(entry.active, true); assert.equal(entry.station, station.station); assert.equal(entry.comResult, 0);
  const parent = { process: result.process, socket: point, entry, com }; parents.push(parent); return parent;
}
async function childSpec(image) {
  const point = await channel(), marker = join(root, 'main-' + randomUUID()), firstMarker = join(root, 'tls-' + randomUUID());
  const literal = 'empty space 中文 \\ trailing\\ "quoted"';
  const parameters = ['--shell-station=' + station.station, '--shell-owner=' + await owner(), '--shell-pipe=' + point.pipe, '--shell-marker=' + marker, '--shell-first-marker=' + firstMarker, '--shell-literal=' + literal, ''].map(quote).join(' ');
  return { point, marker, firstMarker, literal, parameters, image };
}
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
async function bareLaunch(image, args) {
  const fixture = spawn(image, args.map(quote), { windowsHide: true, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'] });
  fixture.stdout.resume(); fixture.stderr.resume();
  const owned = { fixture, closed: new Promise((yes) => fixture.once('close', (code, signal) => { owned.closure = { pid: fixture.pid, code, signal, at: new Date().toISOString(), stdioClosed: true }; yes(owned.closure); })) };
  bareFixtures.push(owned); return owned;
}
try {
  await cp(resolve('.tools/native-clipboard'), assets, { recursive: true });
  const manifest = JSON.parse(await readFile(join(assets, 'native-clipboard.json'), 'utf8')); assert.equal(manifest.version, 7); proof.build = manifest.build; proof.assets = manifest.files;
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
