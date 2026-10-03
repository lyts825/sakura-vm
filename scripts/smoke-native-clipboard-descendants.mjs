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
const root = resolve('.data/native-clipboard-test-temp/descendant-' + randomUUID());
await mkdir(root, { recursive: true });
process.env.TEMP = process.env.TMP = root;
console.log('Descendant private fixture: ' + root);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  execute = promisify(execFile);
const sourceFiles = [
  'native/windows-clipboard/descendant.h',
  'native/windows-clipboard/descendant-reservation.h',
  'native/windows-clipboard/descendant-policy.h',
  'native/windows-clipboard/descendant-controller.h',
  'native/windows-clipboard/controller.cpp',
  'native/windows-clipboard/policy.cpp',
  'native/windows-clipboard/protocol.h',
  'native/windows-clipboard/early-import.h',
  'native/windows-clipboard/control-system.h',
  'native/windows-clipboard/fixture-descendant.h',
  'native/windows-clipboard/fixture-descendant-dll.cpp',
  'native/windows-clipboard/fixture-descendant-parent.cpp',
  'native/windows-clipboard/fixture-descendant-managed.cs',
  'native/windows-clipboard/fixture-descendant-terminate.cs',
  'server/native-clipboard.ts',
  'server/native-clipboard-descendants.ts',
  'scripts/build-native-clipboard.mjs',
  'scripts/smoke-native-clipboard-descendants.mjs',
];
const sourceSha256 = Object.fromEntries(
  await Promise.all(sourceFiles.map(async (file) => [file, hash(await readFile(file))])),
);
const proof = {
  version: 1,
  kind: 'actual-createprocess-descendant-clipboard',
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
    enter: (value) => enter(value),
    release: () => release(),
  };
  gates.push(point);
  return point;
}
const options = {
  file,
  assets,
  interval: 0,
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
        get alive() {
          return channel.alive;
        },
        async close() {
          await channel.close();
          assert.ok(channel.closure, 'broker close waits for actual process and stdout/stderr close');
          (proof.channelClosures ||= []).push({ process: channel.process, ...channel.closure });
        },
      };
    return wrapped;
  },
  launch: (helper, args, hooks, signal) =>
    nativeLaunch(
      helper,
      args,
      {
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
              const stop = () => {
                aborted = true;
                reject(new Error('owned descendant generation retired'));
              };
              if (signal.aborted) stop();
              else signal.addEventListener('abort', stop, { once: true });
            });
          }
        },
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
async function channel() {
  const pipe = '\\\\.\\pipe\\SakuraDescendantFixture.' + randomUUID(),
    server = createServer();
  let socket,
    reader,
    ended = false;
  const queued = [],
    waiting = [];
  server.on('connection', (connection) => {
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
    write: (text) => socket?.write(text),
    next: () =>
      queued.length
        ? Promise.resolve(queued.shift())
        : ended
          ? Promise.reject(new Error('owned fixture already closed'))
          : new Promise((resolve, reject) => {
              const item = {
                resolve: (value) => {
                  clearTimeout(timer);
                  resolve(value);
                },
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
    close: async () => {
      socket?.destroy();
      reader?.close();
      await new Promise((yes) => server.close(yes));
    },
    get connected() {
      return !!socket;
    },
  };
  channels.push(result);
  return result;
}
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
const same = (left, right) => left.pid === right.pid && left.created === right.created;
async function gone(process) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (!(await inventory()).some((item) => same(item, process))) return;
    await delay(100);
  }
  throw new Error('owned descendant remains alive: ' + JSON.stringify(process));
}
async function owner() {
  return JSON.parse(await readFile(file, 'utf8')).owner;
}
async function actualStatus(process) {
  return nativeCommand(join(assets, 'sakura-clipboard-controller.exe'), [
    'status',
    await owner(),
    String(process.pid),
    process.created,
  ]);
}
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
const scannedApplies = (process, offset) =>
  nativeCalls
    .slice(offset)
    .filter((args) => args[0] === 'apply' && args[2] === String(process.pid) && args[3] === process.created)
    .length;
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
async function childSpawn(parent, image, kind = 'native', mode = 'W', expected = true, markerPath) {
  const connection = await channel(),
    marker = markerPath || join(root, 'marker-' + randomUUID());
  parent.connection.write(
    ['spawn', mode, image, connection.pipe, kind, marker, dirname(image)].join('\t') + '\n',
  );
  const process = await parent.connection.next();
  assert.equal(
    process.started,
    expected,
    JSON.stringify({ process, error: service.view().error, processes: service.view().processes }),
  );
  if (expected) children.push({ process, connection, marker });
  return { process, connection, marker };
}
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
try {
  await cp(resolve('.tools/native-clipboard'), assets, { recursive: true });
  const manifest = JSON.parse(await readFile(join(assets, 'native-clipboard.json'), 'utf8'));
  assert.equal(manifest.version, 5);
  proof.build = manifest.build;
  proof.assets = manifest.files;
  const compiler64 = process.env.SAKURA_NATIVE_CLIPBOARD_CXX || 'g++.exe',
    compiler32 =
      process.env.SAKURA_NATIVE_CLIPBOARD_CXX32 || resolve('.tools/mingw32-16.2.0/mingw32/bin/g++.exe');
  const common = ['-std=c++17', '-O2', '-s', '-static', '-Wl,--no-insert-timestamp'];
  const nativeParents = {},
    nativeChildren = {};
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
      ],
      'parent-' + bits,
    );
    nativeParents[bits] = join(folder, 'parent.exe');
    nativeChildren[bits] = join(folder, 'child.exe');
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
  for (const boundary of ['configure', 'close']) {
    fault = 'gate';
    aborted = false;
    let enteredResolve;
    const enteredPromise = new Promise((yes) => {
      enteredResolve = yes;
    });
    entered = enteredResolve;
    const pending = childSpawn(parent64, nativeChildren[32], 'native', 'W', false);
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
      kind: 'generation-' + boundary + '-while-prepared',
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
