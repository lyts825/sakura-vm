import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { defaultClipboardRule } from '../shared/clipboard-policy.ts';
import type { X11ClipboardView, X11ClipboardSession } from '../shared/x11-clipboard.ts';

const distro = process.argv[2] || 'debian';
assert.ok(['debian', 'ubuntu', 'alpine'].includes(distro));
const directory = process.argv[3] ? resolve(process.argv[3]) : await mkdtemp(join(tmpdir(), 'sakura-x11-'));
assert.equal(dirname(await realpath(directory)), await realpath(tmpdir()));
assert.match(basename(directory), /^sakura-x11-/);
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve(
  '.data/images',
  { debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2', alpine: 'alpine-3.23.qcow2' }[distro]!,
);
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Desktops } = await import('../server/desktop.ts');
const { DesktopBindings } = await import('../server/desktop-binding.ts');
const { X11Clipboard } = await import('../server/x11-clipboard.ts');
const { quote } = await import('../server/files.ts');
const { projectNetworkCommand } = await import('../server/project-network-isolation.ts');
const { x11SourceBundle } = await import('../server/x11-clipboard-assets.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines),
  desktops = new Desktops(machines, workspaces);
let native = desktops.clipboard;
let vmId = '';
const program = '/usr/local/lib/sakura-x11-test/fixture',
  qtProgram = '/usr/local/lib/sakura-x11-test/fixture-qt';
async function command(script: string, timeout = 30000) {
  const result = await machines.exec(vmId, script, timeout);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
async function upload(name: string) {
  const bytes = await readFile(resolve('native/linux-clipboard', name));
  await machines.sftp(vmId, async (ftp) => {
    await pipeline(
      Readable.from([bytes]),
      ftp.createWriteStream('/root/sakura-x11-build/' + name, { flags: 'w', mode: 0o600 }),
    );
  });
}
async function ready() {
  const deadline = Date.now() + 1200000;
  let progress = Date.now();
  for (;;) {
    const view = await desktops.view(vmId);
    assert.notEqual(view.status, 'error', view.error + '\n' + view.log);
    if (view.status === 'ready') return;
    if (Date.now() > progress) {
      console.log('Owned KDE preparation:', view.status, view.log.slice(-500));
      progress = Date.now() + 45000;
    }
    assert.ok(Date.now() < deadline, 'desktop preparation timed out');
    await delay(1000);
  }
}
async function action(input: object) {
  return await native.action(vmId, input);
}
async function save(image: string, rule = defaultClipboardRule()) {
  const identity = (await action({ action: 'identify', image })) as { image: string; sha256: string };
  const state = await native.view(vmId);
  const value = (await action({
    action: 'save',
    version: state.version,
    application: { ...identity, rule },
  })) as X11ClipboardView;
  assert.ok(!value.error, value.error);
  return value;
}
async function launch(image: string, args: string[]) {
  const state = await native.view(vmId);
  const value = (await action({
    action: 'launch',
    version: state.version,
    image,
    args,
  })) as X11ClipboardSession;
  assert.equal(value.state, 'running', value.error);
  assert.equal(value.active, true);
  return value;
}
async function stop(id: string) {
  await action({ action: 'stop', id });
}
async function marker(path: string) {
  for (let i = 0; i < 100; i++) {
    const found = await machines.exec(vmId, `test -f ${quote(path)} && cat ${quote(path)}`, 10000);
    if (found.code === 0) return found.stdout.trim();
    await delay(100);
  }
  throw Error('controlled application did not write its owned probe result');
}
try {
  const vm =
    [...machines.records.values()][0] ||
    (await machines.create({
      name: 'x11-clipboard-' + distro,
      distro: distro as 'debian' | 'ubuntu' | 'alpine',
      cpus: 2,
      memoryMiB: 2048,
      diskGiB: 8,
    }));
  vmId = vm.id;
  console.log('Owned X11 fixture:', directory, vmId);
  await machines.start(vmId);
  const bootDeadline = Date.now() + 300000;
  while (machines.state(vmId) === 'starting' && Date.now() < bootDeadline) await delay(500);
  assert.equal(machines.state(vmId), 'running', machines.logs.get(vmId));
  const before = await desktops.view(vmId);
  if (['ready', 'starting', 'stopped'].includes(before.status)) await desktops.stop(vmId);
  await workspaces.save(vmId, {
    directory: '/workspace/clipboard',
    networkIsolation: 'private',
    environment: { SAKURA_X11_TEST_VALUE: 'owned-fixture-value' },
  });
  desktops.start(vmId, before.status === 'not-installed' ? 'install' : 'start');
  await ready();
  native.install(vmId);
  await native.jobs.wait(vmId);
  const installed = native.jobs.view(vmId)!;
  assert.equal(installed.status, 'done', installed.error + '\n' + installed.log);
  assert.equal((await native.view(vmId)).ready, true);
  await command('mkdir -p /root/sakura-x11-build /usr/local/lib/sakura-x11-test');
  for (const file of ['fixture.cpp', 'fixture-qt.cpp', 'smoke.py']) await upload(file);
  const qt = distro === 'alpine' ? 'Qt6Gui' : 'Qt5Gui';
  await command(
    distro === 'alpine'
      ? 'apk add --no-cache qt6-qtbase-dev pkgconf xvfb xauth xclip'
      : 'DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y -qq --no-install-recommends qtbase5-dev pkg-config xvfb xauth xclip' +
          (process.env.SAKURA_X11_DEBUG === '1' ? ' gdb' : ''),
    240000,
  );
  await command(
    `set -eu\ncd /root/sakura-x11-build\ng++ -std=c++17 -O2 -Wall -Wextra fixture.cpp -o ${program} -lX11 -lX11-xcb -lxcb -pthread\n` +
      `g++ -std=c++17 -O2 -fPIC -Wall -Wextra fixture-qt.cpp -o ${qtProgram} $(pkg-config --cflags --libs ${qt})\nchmod 755 ${program} ${qtProgram}`,
    90000,
  );
  const bundle = await x11SourceBundle();
  console.log(
    await command(
      `python3 /root/sakura-x11-build/smoke.py ${quote(bundle.directory + '/libSakuraClipboard.so')} ${program} ${bundle.manifest.build}`,
      300000,
    ),
  );
  // A clipboard manager retains already exported bytes. Disable only this
  // fixture desktop's Klipper while testing the selection owner's new replies.
  await command('pkill -u sakura-desktop -x klipper || true');
  const dataFile = '/usr/local/lib/sakura-x11-test/data.txt';
  await command(`printf %s ${quote('ordinary native clipboard text')} > ${dataFile}\nchmod 644 ${dataFile}`);
  await save(program);
  const sourceMarker = '/home/sakura-desktop/sakura-x11-' + randomUUID();
  const source = await launch(program, [
    'xlib',
    'owner',
    'UTF8_STRING',
    dataFile,
    'CLIPBOARD',
    'ordinary',
    sourceMarker,
  ]);
  try {
    assert.equal(await marker(sourceMarker), 'READY');
  } catch (error) {
    console.log('Owned source readiness diagnosis:', JSON.stringify((await native.view(vmId)).sessions));
    console.log(await command('ps -u sakura-desktop -o pid,ppid,wchan:30,comm'));
    if (process.env.SAKURA_X11_DEBUG === '1')
      for (const row of source.processes || [])
        if (row.image === program) {
          const trace = await machines.exec(
            vmId,
            `gdb -batch -ex 'thread apply all bt' -p ${row.pid}`,
            20000,
          );
          console.log('Owned fixture stack:', trace.stdout, trace.stderr);
        }
    throw error;
  }
  const project = await workspaces.config(vmId);
  const plainRead = (toolkit: string) =>
    projectNetworkCommand(
      project,
      `exec env DISPLAY=:1 XAUTHORITY=/run/sakura-desktop/Xauthority setpriv --reuid $(id -u sakura-desktop) --regid $(id -g sakura-desktop) --init-groups --no-new-privs ${program} ${toolkit} read UTF8_STRING ${dataFile}`,
    );
  const firstRead = await machines.exec(vmId, plainRead('xcb'), 15000);
  if (firstRead.code !== 0) {
    console.log(
      'Owned fixture read diagnosis:',
      JSON.stringify({ firstRead, state: await native.view(vmId) }),
    );
    console.log(
      await command(
        'ps -u sakura-desktop -o pid,ppid,comm\nfind /sys/fs/cgroup -maxdepth 2 -name "sakura-clipboard-*"',
      ),
    );
    for (const row of source.processes || [])
      console.log(
        await command(
          `printf 'Owned PID ${row.pid}: '; cat /proc/${row.pid}/wchan; cat /proc/${row.pid}/status | sed -n '/State:/p'`,
        ),
      );
  }
  assert.equal(firstRead.code, 0, firstRead.stderr || firstRead.stdout);
  assert.equal(firstRead.stdout.trim(), Buffer.from('ordinary native clipboard text').toString('hex'));
  const owner = (await native.view(vmId)).sessions.find((row) => row.id === source.id)!;
  assert.ok(owner.processes!.every((row) => row.loaded));
  await save(program, { ...defaultClipboardRule(), copy: false });
  assert.equal(await command(plainRead('xcb')), 'DENIED');
  assert.ok((await native.view(vmId)).sessions.find((row) => row.id === source.id)!.blockedCopy! > 0);
  await native.close();
  const binding = await new DesktopBindings(machines).read(vmId);
  assert.ok(binding);
  native = new X11Clipboard(machines, async () => ({
    project: await workspaces.resolvedConfig(vmId),
    launcherSha256: binding.launcherSha256,
  }));
  assert.equal(await command(plainRead('xcb')), 'DENIED');
  await save(program);
  assert.notEqual(await command(plainRead('xcb')), 'DENIED');
  await save(qtProgram, { ...defaultClipboardRule(), paste: false });
  const markerPath = '/home/sakura-desktop/sakura-x11-' + randomUUID();
  const denied = await launch(qtProgram, ['probe', markerPath, 'fixture']);
  assert.equal(await marker(markerPath), 'DENIED');
  assert.ok((await native.view(vmId)).sessions.find((row) => row.id === denied.id)!.blockedPaste! > 0);
  await stop(denied.id);
  await save(qtProgram);
  await command(`rm -f ${quote(markerPath)}`);
  const allowed = await launch(qtProgram, ['probe', markerPath, 'fixture']);
  assert.equal(await marker(markerPath), Buffer.from('ordinary native clipboard text').toString('hex'));
  await stop(allowed.id);
  await stop(source.id);
  const qtSource = await launch(qtProgram, ['owner', dataFile, 'fixture']);
  let qtRead = '';
  for (let i = 0; i < 20; i++) {
    qtRead = await command(plainRead('xlib'));
    if (qtRead !== 'DENIED') break;
    await delay(100);
  }
  assert.equal(qtRead, Buffer.from('ordinary native clipboard text').toString('hex'));
  await save(qtProgram, { ...defaultClipboardRule(), copy: false });
  assert.equal(await command(plainRead('xlib')), 'DENIED');
  assert.ok((await native.view(vmId)).sessions.find((row) => row.id === qtSource.id)!.blockedCopy! > 0);
  await action({ action: 'remove', version: (await native.view(vmId)).version, image: qtProgram });
  assert.equal(
    await command(plainRead('xlib')),
    Buffer.from('ordinary native clipboard text').toString('hex'),
  );
  await stop(qtSource.id);
  const largeData = Buffer.from('owned Qt incremental 界é text\n'.repeat(10000));
  assert.ok(largeData.length > 256 * 1024 && largeData.length < 1048576);
  const largeFile = '/usr/local/lib/sakura-x11-test/incremental.txt';
  await machines.sftp(vmId, async (ftp) => {
    await pipeline(Readable.from([largeData]), ftp.createWriteStream(largeFile, { flags: 'w', mode: 0o644 }));
  });
  const largeRead = (toolkit: string) => plainRead(toolkit).replace(dataFile, largeFile);
  await save(program);
  await save(qtProgram);
  const incrMarker = '/home/sakura-desktop/sakura-x11-' + randomUUID();
  const incrSource = await launch(program, [
    'mixed', 'owner', 'UTF8_STRING', largeFile, 'CLIPBOARD', 'incr:32767', incrMarker,
  ]);
  assert.equal(await marker(incrMarker), 'READY');
  assert.equal(await command(largeRead('xcb')), largeData.toString('hex'));
  const qtIncrMarker = '/home/sakura-desktop/sakura-x11-' + randomUUID();
  const qtIncrSink = await launch(qtProgram, ['probe', qtIncrMarker, 'fixture']);
  assert.equal(await marker(qtIncrMarker), largeData.toString('hex'));
  await stop(qtIncrSink.id);
  await stop(incrSource.id);
  const qtIncrSource = await launch(qtProgram, ['owner', largeFile, 'fixture']);
  let qtIncrRead = '';
  for (let i = 0; i < 20; i++) {
    qtIncrRead = await command(largeRead('mixed'));
    if (qtIncrRead !== 'DENIED') break;
    await delay(100);
  }
  assert.equal(qtIncrRead, largeData.toString('hex'));
  await save(qtProgram, { ...defaultClipboardRule(), maxTextBytes: 1024 });
  assert.equal(await command(largeRead('xcb')), 'DENIED');
  await save(qtProgram);
  await stop(qtIncrSource.id);
  console.log('Real KDE/Qt >256KiB INCR in both directions, mixed aliases and live size tightening passed');
  const stopped = await native.view(vmId);
  assert.equal(stopped.sessions.find((row) => row.id === source.id)!.state, 'stopped');
  await action({ action: 'forget', id: source.id });
  assert.ok(!(await native.view(vmId)).sessions.some((row) => row.id === source.id));
  console.log(
    'Real KDE private project, Xlib/XCB/Qt in both directions including INCR, live rules, disable, counters, service reload and cgroup cleanup passed',
  );
} finally {
  await native.close();
  await desktops.close();
  await workspaces.close();
  if (vmId && machines.live.has(vmId)) {
    await machines.exec(vmId, 'sync', 10000).catch(() => {});
    await machines.stop(vmId, true);
  }
  await machines.close();
  if (process.env.SAKURA_KEEP_X11_SMOKE === '1' || process.argv[3])
    console.log('Retained owned fixture:', directory);
  else {
    assert.equal(dirname(await realpath(directory)), await realpath(tmpdir()));
    assert.match(basename(directory), /^sakura-x11-/);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
