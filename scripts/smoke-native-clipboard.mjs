import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, copyFile, cp, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';
import { NativeClipboard } from '../server/native-clipboard.ts';

if (process.platform !== 'win32') throw new Error('The native clipboard smoke requires Windows.');
const execute = promisify(execFile);
const folder = resolve('.data/native-clipboard-test-temp/fixture-' + randomUUID());
await mkdir(folder, { recursive: true });
const compiler = process.env.SAKURA_NATIVE_CLIPBOARD_CXX || 'g++.exe';
const fixture = join(folder, 'fixture.exe'),
  other = join(folder, 'other.exe');
await execute(
  compiler,
  [
    '-std=c++17',
    '-O2',
    '-s',
    '-static',
    '-municode',
    resolve('native/windows-clipboard/fixture.cpp'),
    '-o',
    fixture,
    '-lole32',
    '-luuid',
    '-lshell32',
    '-ladvapi32',
  ],
  { windowsHide: true, timeout: 60000 },
);
await copyFile(fixture, other);
const assets = resolve(process.env.SAKURA_NATIVE_CLIPBOARD_ASSETS || '.tools/native-clipboard');
const controller = join(assets, 'sakura-clipboard-controller.exe');
const library = join(assets, 'SakuraClipboardPolicy.dll');
const owner = randomUUID();
async function launch(path, station) {
  let server, socket, lines;
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
  if (station === '--create') {
    const pipe = '\\\\.\\pipe\\SakuraClipboardTest.' + randomUUID();
    server = createServer((connection) => {
      if (socket) {
        connection.destroy();
        return;
      }
      socket = connection;
      receive(socket);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipe, resolve);
    });
    args = ['--launch', pipe];
  }
  const child = spawn(path, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  if (!server) receive(child.stdout);
  child.stderr.on('data', (chunk) => {
    error += chunk;
  });
  child.on('exit', (code) => {
    closed = true;
    for (const wait of waiting.splice(0)) wait.reject(new Error(`fixture closed ${code}: ${error}`));
  });
  child.on('error', (error) => {
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
  return {
    child,
    path,
    ready: next(),
    request: async (action, text) => {
      phase = action;
      (socket || child.stdin).write(action + (text === undefined ? '' : '\t' + text) + '\n');
      return next();
    },
    close: async () => {
      (socket || child.stdin).end();
      if (!closed)
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
let identity, b, c, service;
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
try {
  identity = await a.ready;
  assert.notEqual(identity.station.toLowerCase(), 'winsta0');
  b = await launch(other, identity.station);
  const counterpart = await b.ready;
  assert.equal(counterpart.station, identity.station);
  assert.ok(
    (await agent(['list'])).processes.some(
      (p) => p.pid === identity.pid && p.created === identity.created && p.bits === 64,
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
  const controlled = service.view().processes.filter((item) => item.state === 'enforced');
  assert.ok(
    controlled.some((item) => item.pid === identity.pid) && controlled.some((item) => item.pid === third.pid),
  );
  assert.ok(controlled.every((item) => item.image.toLowerCase() === fixture.toLowerCase()));
  await service.close();
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
  await service.action({
    action: 'configure',
    version: service.view().version,
    settings: { ...service.view().settings, enabled: false },
  });
  assert.equal((await a.request('write', 'service disabled')).ok, true);
  assert.equal((await c.request('write', 'new process disabled')).ok, true);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).managed.length, 0);
  console.log(
    'Actual server executable binding, automatic new-process enforcement through UI lock, restart ownership and explicit disable passed.',
  );
} finally {
  await service?.close();
  await Promise.allSettled([a.close(), b?.close(), c?.close()]);
}
