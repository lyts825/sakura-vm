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
async function launch(path, station, controlled) {
  let server, socket, lines, pipe;
  const queued = [],
    waiting = [];
  let error = '',
    closed = false,
    phase = 'startup';
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
  const next = () =>
    queued.length
      ? Promise.resolve(queued.shift())
      : closed
        ? Promise.reject(new Error('fixture closed'))
        : new Promise((resolve, reject) => {
            const waiter = {
              resolve: (result) => {
                clearTimeout(timer);
                resolve(result);
              },
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
    request: async (action, text) => {
      phase = action;
      (socket || child.stdin).write(action + (text === undefined ? '' : '\t' + text) + '\n');
      return next();
    },
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
async function agent(args) {
  try {
    const { stdout } = await execute(controller, args, { windowsHide: true, timeout: 70000 });
    return JSON.parse(stdout);
  } catch (error) {
    if (error.stdout) throw new Error(JSON.parse(error.stdout).error);
    throw error;
  }
}
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
