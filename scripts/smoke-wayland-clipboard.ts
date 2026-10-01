import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Reuse only the explicit, stopped fixture already created by the X11 smoke.
// No default user VM inventory is ever opened by this script.
assert.ok(process.argv.length === 3 || process.argv.length === 4 && process.argv[3] === '--stop-owned',
  'Pass the owned Debian X11 fixture directory, optionally --stop-owned for exact fixture cleanup.');
const parent = await realpath(resolve('.data/linux-clipboard-test-temp'));
const directory = await realpath(resolve(process.argv[2]));
assert.equal(dirname(directory), parent);
assert.match(basename(directory), /^sakura-x11-[A-Za-z0-9_-]+$/);
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/debian-12.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { quote } = await import('../server/files.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Desktops } = await import('../server/desktop.ts');
const { DesktopBindings } = await import('../server/desktop-binding.ts');
const { WaylandClipboard } = await import('../server/wayland-clipboard.ts');
import type { X11ClipboardSession, X11ClipboardView } from '../shared/x11-clipboard.ts';
const machines = new Machines(await createRuntime());
await machines.init();
assert.equal(machines.records.size, 1);
const vm = [...machines.records.values()][0];
assert.equal(vm.name, 'x11-clipboard-debian');
assert.equal(vm.distro, 'debian');
const previousEvidence = await readFile(join(directory, 'native-wayland-evidence.json'), 'utf8')
  .then((value) => JSON.parse(value)).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
if (previousEvidence) assert.equal(previousEvidence.vmId, vm.id, 'Owned fixture evidence points at another VM.');
if (process.argv[3] === '--stop-owned') {
  if (machines.state(vm.id) !== 'stopped') await machines.stop(vm.id, true);
  await machines.close();
  console.log('Stopped only the explicitly verified owned Wayland fixture:', vm.id);
  process.exit(0);
}
assert.equal(machines.state(vm.id), 'stopped');
const nonce = randomUUID().replaceAll('-', '');
const guestRoot = '/run/sakura-wayland-smoke-' + nonce;
const programDirectory = '/usr/local/lib/sakura-wayland-test/' + nonce;
const project = '/var/tmp/sakura-wayland-smoke-' + nonce;
const evidence: object[] = [];
let passed = false, failure: string | undefined, sourceBuild: string | undefined;
let qtSha256: string | undefined, gtkSha256: string | undefined;
let sourceFiles: Array<{ name: string; sha256: string }> = [];
const run = async (script: string, timeout = 30_000) => {
  const result = await machines.exec(vm.id, script, timeout);
  if (result.code !== 0) console.log(result.stdout);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return result.stdout.trim();
};
const upload = async (path: string, bytes: Buffer, mode = 0o600) =>
  machines.sftp(vm.id, (ftp) => pipeline(Readable.from([bytes]), ftp.createWriteStream(path, { flags: 'w', mode })));
const sessions: string[] = [];
const productionSessions: string[] = [];
let desktops: InstanceType<typeof Desktops> | undefined;
let production: InstanceType<typeof WaylandClipboard> | undefined;
let controller = '', owner = randomUUID(), launcher = '', compositor: object = {}, destination = '';
let serial = 0;
let upstreamSocket = guestRoot + '/compositor/wayland-owned';
let focusDisplay = ':94', focusAuthority: string | undefined;
const mimeText = 'text/plain;charset=utf-8';
type Rule = typeof rule;
type Toolkit = 'qt' | 'gtk';
const directProcesses: Array<{ pid: number; created: string }> = [];
async function action(request: object) {
  const encoded = Buffer.from(JSON.stringify({ ...request, owner })).toString('base64');
  return JSON.parse(await run(`/usr/bin/python3 -I -S ${quote(controller)} ${quote(encoded)}`, 30_000));
}
async function marker(path: string) {
  for (let n = 0; n < 100; n++) {
    const result = await machines.exec(vm.id, `test -f ${quote(path)}`, 10_000);
    if (result.code === 0) return machines.sftp(vm.id, (ftp) => new Promise<string>((resolveMarker, rejectMarker) => {
      const stream = ftp.createReadStream(path), chunks: Buffer[] = [];
      let length = 0, ended = false;
      stream.on('error', rejectMarker);
      stream.on('data', (value: Buffer) => {
        length += value.length;
        if (length > 16_781_312) stream.destroy(Error('Owned fixture marker exceeds its bounded body limit'));
        else chunks.push(value);
      });
      stream.on('end', () => { ended = true; });
      // ssh2's stream closes its remote handle after EOF. Do not tear down
      // the SFTP/SSH session while that final CLOSE request is outstanding.
      stream.on('close', () => ended ? resolveMarker(Buffer.concat(chunks).toString().trim()) : rejectMarker(Error('Owned marker read incomplete')));
    }));
    await delay(100);
  }
  throw Error('native Wayland fixture marker timed out: ' + path);
}
const rule = { copy: true, paste: true, files: false, sensitive: true, maxTextBytes: 1_048_576 };
async function focus() {
  await run(`sleep .25\nenv DISPLAY=${quote(focusDisplay)} ${focusAuthority ? 'XAUTHORITY=' + quote(focusAuthority) : ''} xdotool mousemove 500 380 click 1 key F8`);
}
async function launch(args: string[], policy = rule, toolkit: Toolkit = 'qt') {
  const image = programDirectory + '/fixture-' + toolkit;
  const identity = await action({ action: 'identify', image });
  const id = randomUUID(); sessions.push(id);
  const value = await action({ action: 'launch', id, ...identity, args, rule: policy, generation: 1,
    directory: project, projectId: 'default', networkNamespace: null, environment: {}, launcherSha256: launcher, compositor });
  assert.equal(value.state, 'running', value.error);
  await focus();
  return id;
}
async function session(id: string) {
  const result = await action({ action: 'list' });
  return result.sessions.find((item: { id: string }) => item.id === id);
}
async function stop(id: string) {
  assert.equal((await action({ action: 'stop', id })).stopped, true);
}
async function configure(id: string, policy: Rule, generation: number, enabled = true) {
  const result = await action({ action: 'configure', id, rule: policy, generation, enabled });
  assert.equal(result.generation, generation);
  assert.equal(result.active, enabled);
}
async function direct(toolkit: Toolkit, args: string[]) {
  const prefix = guestRoot + '/client-' + (++serial);
  const raw = await run(`set -eu\nsetsid setpriv --reuid sakura-desktop --regid sakura-desktop --clear-groups env -u DISPLAY -u XAUTHORITY -u WAYLAND_SOCKET HOME=/home/sakura-desktop USER=sakura-desktop LOGNAME=sakura-desktop XDG_RUNTIME_DIR=${quote(upstreamSocket.slice(0, upstreamSocket.lastIndexOf('/')))} WAYLAND_DISPLAY=${quote(upstreamSocket)} QT_QPA_PLATFORM=wayland GDK_BACKEND=wayland dbus-run-session -- ${quote(programDirectory + '/fixture-' + toolkit)} ${args.map(quote).join(' ')} >${quote(prefix + '.log')} 2>&1 < /dev/null &\np="$!"\n/usr/bin/python3 -I -S -c ${quote("import sys,json; p=int(sys.argv[1]);r=open('/proc/'+str(p)+'/stat').read();f=r[r.rfind(')')+2:].split();print(json.dumps({'pid':p,'created':f[19]}))")} "$p"`);
  const identity = JSON.parse(raw); directProcesses.push(identity);
  await focus();
  return identity;
}
async function stopDirect(identity: { pid: number; created: string }) {
  await run(`/usr/bin/python3 -I -S -c ${quote(`import os,signal
p=${identity.pid}
try:
 r=open('/proc/'+str(p)+'/stat').read();f=r[r.rfind(')')+2:].split()
 if f[19]==${JSON.stringify(identity.created)} and os.getpgid(p)==p: os.killpg(p,signal.SIGTERM)
except ProcessLookupError: pass
except FileNotFoundError: pass`)}`);
}
async function bodyFile(body: Buffer) {
  const input = project + '/input-' + (++serial);
  await upload(input, body, 0o644); return input;
}
async function source(body: Buffer, managed: boolean, toolkit: Toolkit = 'qt', policy = rule,
  mime = mimeText, mode = 'CLIPBOARD', sourceDelay = 0) {
  const input = await bodyFile(body), ready = project + '/ready-' + (++serial);
  const args = ['owner', input, ready, mime, mode, String(sourceDelay)];
  const handle = managed ? await launch(args, policy, toolkit) : await direct(toolkit, args);
  assert.match(await marker(ready), /^READY (?:wayland|gtk-wayland)/);
  return { input, handle, managed };
}
async function probe(managed: boolean, toolkit: Toolkit = 'qt', policy = rule,
  mime = mimeText, mode = 'CLIPBOARD') {
  const result = project + '/result-' + (++serial), args = ['probe', '/dev/null', result, mime, mode];
  const handle = managed ? await launch(args, policy, toolkit) : await direct(toolkit, args);
  const value = await marker(result);
  if (managed) await stop(handle as string); else await stopDirect(handle as { pid: number; created: string });
  return value;
}
async function closeSource(value: Awaited<ReturnType<typeof source>>) {
  if (value.managed) await stop(value.handle as string); else await stopDirect(value.handle as { pid: number; created: string });
}
async function brokerStatus(id: string) {
  return JSON.parse(await run(`cat ${quote('/var/lib/sakura/wayland-clipboard/' + owner + '/' + id + '/status')}`));
}
try {
  console.log('Owned native Wayland fixture:', directory, vm.id);
  await machines.start(vm.id);
  const deadline = Date.now() + 300_000;
  while (machines.state(vm.id) === 'starting' && Date.now() < deadline) await delay(500);
  assert.equal(machines.state(vm.id), 'running', machines.logs.get(vm.id));
  await run('DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y -qq --no-install-recommends kwin-wayland qtwayland5 qtbase5-dev libgtk-3-dev libwayland-dev wayland-protocols weston xdotool xvfb pkg-config', 240_000);
  await run(`set -eu\nmkdir -m 755 ${quote(guestRoot)}\nmkdir -m 1777 ${quote(project)}\nmkdir -m 700 ${quote(guestRoot + '/compositor')}\nchown sakura-desktop:sakura-desktop ${quote(guestRoot + '/compositor')}\nmkdir -p ${quote(programDirectory)}\nchmod 755 /usr/local/lib/sakura-wayland-test ${quote(programDirectory)}`);
  launcher = await run('sha256sum /usr/local/libexec/sakura-desktop-launcher | cut -d" " -f1');
  await upload(guestRoot + '/fixture-qt.cpp', await readFile(resolve('native/wayland-clipboard/fixture-qt.cpp')));
  await upload(guestRoot + '/fixture-gtk.c', await readFile(resolve('native/wayland-clipboard/fixture-gtk.c')));
  await run(`g++ -std=c++17 -O2 -Wall -Wextra -fPIC ${quote(guestRoot + '/fixture-qt.cpp')} -o ${quote(programDirectory + '/fixture-qt')} $(pkg-config --cflags --libs Qt5Gui)\nchmod 755 ${quote(programDirectory + '/fixture-qt')}`);
  await run(`cc -std=c11 -O2 -Wall -Wextra ${quote(guestRoot + '/fixture-gtk.c')} -o ${quote(programDirectory + '/fixture-gtk')} $(pkg-config --cflags --libs gtk+-3.0)\nchmod 755 ${quote(programDirectory + '/fixture-gtk')}`);
  qtSha256 = await run(`sha256sum ${quote(programDirectory + '/fixture-qt')} | cut -d' ' -f1`);
  gtkSha256 = await run(`sha256sum ${quote(programDirectory + '/fixture-gtk')} | cut -d' ' -f1`);
  console.log('Native Qt fixture compiled; compositor:', await run('weston --version'));
  // Dedicated Xvfb supplies nested compositor input/output only. Every tested
  // clipboard client uses its native Wayland socket, with DISPLAY unset.
  await run(`set -eu\nsetsid Xvfb :94 -screen 0 1024x768x24 -nolisten tcp >${quote(guestRoot + '/xvfb.log')} 2>&1 < /dev/null &\nprintf '%s' "$!" >${quote(guestRoot + '/xvfb.pid')}\nfor n in $(seq 1 100); do test -S /tmp/.X11-unix/X94 && break; sleep .05; done\ntest -S /tmp/.X11-unix/X94`);
  await run(`set -eu\nsetsid setpriv --reuid sakura-desktop --regid sakura-desktop --clear-groups env HOME=/home/sakura-desktop USER=sakura-desktop LOGNAME=sakura-desktop DISPLAY=:94 XDG_RUNTIME_DIR=${quote(guestRoot + '/compositor')} LIBGL_ALWAYS_SOFTWARE=1 dbus-run-session -- weston --backend=x11-backend.so --use-pixman --socket=wayland-owned --width=1024 --height=768 --idle-time=0 >${quote(guestRoot + '/compositor.log')} 2>&1 < /dev/null &\nprintf '%s' "$!" >${quote(guestRoot + '/compositor-launcher.pid')}\nfor n in $(seq 1 100); do test -S ${quote(guestRoot + '/compositor/wayland-owned')} && break; sleep .1; done\ntest -S ${quote(guestRoot + '/compositor/wayland-owned')}`);
  compositor = JSON.parse(await run(`/usr/bin/python3 -I -S -c ${quote(`import socket,struct,json,os
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.connect(${JSON.stringify(guestRoot + '/compositor/wayland-owned')})
p,u,g=struct.unpack('3i',s.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12));r=open('/proc/'+str(p)+'/stat').read();f=r[r.rfind(')')+2:].split()
print(json.dumps({'socket':${JSON.stringify(guestRoot + '/compositor/wayland-owned')},'pid':p,'uid':u,'created':f[19]}))`)}`));
  console.log('Pinned real native compositor:', compositor);
  evidence.push({ compositor });
  const directInput = project + '/direct-plain', directMarker = project + '/direct-ready';
  await upload(directInput, Buffer.from('native direct baseline'), 0o644);
  await run(`set -eu\nsetsid setpriv --reuid sakura-desktop --regid sakura-desktop --clear-groups env -u DISPLAY -u XAUTHORITY -u WAYLAND_SOCKET HOME=/home/sakura-desktop USER=sakura-desktop LOGNAME=sakura-desktop XDG_RUNTIME_DIR=${quote(guestRoot + '/compositor')} WAYLAND_DISPLAY=wayland-owned QT_QPA_PLATFORM=wayland dbus-run-session -- ${quote(programDirectory + '/fixture-qt')} owner ${quote(directInput)} ${quote(directMarker)} ${quote('text/plain;charset=utf-8')} >${quote(guestRoot + '/direct.log')} 2>&1 < /dev/null &\nprintf '%s' "$!" >${quote(guestRoot + '/direct.pid')}\nsleep .5\nenv DISPLAY=:94 xdotool search --onlyvisible --name 'Weston Compositor' | head -1 | xargs -r env DISPLAY=:94 xdotool windowfocus\nenv DISPLAY=:94 xdotool mousemove 500 380 click 1 key F8`);
  try { assert.match(await marker(directMarker), /^READY wayland/); }
  catch (error) { console.log('Direct native client diagnostic:', await run(`cat ${quote(guestRoot + '/direct.log')}`)); throw error; }
  await run(`kill -- -"$(cat ${quote(guestRoot + '/direct.pid')})"`);
  evidence.push({ unproxiedNativeQtBaseline: true });
  console.log('Unproxied native Qt Wayland baseline passed');
  const folder = resolve('native/wayland-clipboard');
  const metadata = JSON.parse(await readFile(join(folder, 'sources.json'), 'utf8'));
  const names = ['controller.py', 'proxy.py', 'sources.json', ...metadata.files.map((item: { name: string }) => item.name)];
  assert.equal(names.length, 20);
  const files = await Promise.all(names.map(async (name) => ({ name, bytes: await readFile(join(folder, name)) })));
  const hash = createHash('sha256'); for (const file of files) hash.update(file.name).update(file.bytes);
  const build = hash.digest('hex'); destination = '/usr/local/lib/sakura-wayland-clipboard/' + build;
  sourceBuild = build;
  sourceFiles = files.map((file) => ({ name: file.name, sha256: createHash('sha256').update(file.bytes).digest('hex') }));
  await run(`mkdir -p ${quote(destination)}\nchmod 755 ${quote(destination)}`);
  for (const file of files) await upload(destination + '/' + file.name, file.bytes, 0o644);
  await upload(destination + '/manifest.json', Buffer.from(JSON.stringify({ version: 1, build,
    files: files.map((file) => ({ name: file.name, size: file.bytes.length, sha256: createHash('sha256').update(file.bytes).digest('hex') })) })), 0o644);
  controller = destination + '/controller.py';
  await upload(guestRoot + '/wayland-proxy.test.py', await readFile(resolve('tests/wayland-proxy.test.py')));
  console.log('Real Linux wire/FD/FIFO regressions:', await run(`/usr/bin/python3 -I -S ${quote(guestRoot + '/wayland-proxy.test.py')} --source ${quote(destination)} -v 2>&1`, 30_000));
  const plain = project + '/plain', ready = project + '/owner-ready', result = project + '/probe';
  await upload(plain, Buffer.from('native Wayland complete selection'), 0o644);
  const basicSource = await launch(['owner', plain, ready, 'text/plain;charset=utf-8']);
  assert.match(await marker(ready), /^READY wayland/);
  const basicSink = await launch(['probe', plain, result, 'text/plain;charset=utf-8']);
  assert.equal(await marker(result), Buffer.from('native Wayland complete selection').toString('hex'));
  await action({ action: 'stop', id: basicSink });
  await action({ action: 'stop', id: basicSource });
  evidence.push({ nativeQtCopyPaste: true, build });
  console.log('True Qt Wayland complete copy/paste passed');

  const normal = Buffer.from('Native Wayland Qt / GTK 完整正文\n');
  for (const [from, to] of [['qt', 'gtk'], ['gtk', 'qt']] as const) {
    const outgoing = await source(normal, true, from);
    assert.equal(await probe(false, to), normal.toString('hex'));
    await closeSource(outgoing);
    const incoming = await source(normal, false, from);
    assert.equal(await probe(true, to), normal.toString('hex'));
    await closeSource(incoming);
    evidence.push({ copyToUnmanaged: [from, to], pasteFromUnmanaged: [from, to] });
    console.log('Native toolkit directions passed:', from, '→', to);
  }
  const large = Buffer.from('中文完整数据块\n'.repeat(24_000));
  assert.ok(large.length > 262_144);
  const largeSource = await source(large, true, 'qt');
  assert.equal(await probe(false, 'gtk'), large.toString('hex'));
  await closeSource(largeSource);
  const largeIncoming = await source(large, false, 'gtk');
  assert.equal(await probe(true, 'qt'), large.toString('hex'));
  await closeSource(largeIncoming);
  evidence.push({ completePipeBytes: large.length, completePipeDirections: ['copy', 'paste'] });
  console.log('Large complete native Wayland pipes passed:', large.length);

  const blockedCases: Array<{ name: string; bytes: Buffer; policy?: Rule; mime?: string }> = [
    { name: 'sensitive-tail', bytes: Buffer.concat([Buffer.alloc(100_000, 0x61), Buffer.from('\npassword=0123456789abcdef')]) },
    { name: 'invalid-utf8', bytes: Buffer.from([0x61, 0x62, 0xff]) },
    { name: 'size', bytes: Buffer.alloc(2_049, 0x61), policy: { ...rule, maxTextBytes: 1_024 } },
    { name: 'files-disabled', bytes: Buffer.from([0, 1, 2, 3]), mime: 'application/octet-stream', policy: { ...rule, sensitive: false } },
    { name: 'files-enabled-sensitive', bytes: Buffer.from([0, 1, 2, 3]), mime: 'application/octet-stream', policy: { ...rule, files: true } },
    { name: 'portal-token', bytes: Buffer.from('opaque-owned-token'), mime: 'application/vnd.portal.filetransfer', policy: { ...rule, files: true, sensitive: false } },
  ];
  for (const test of blockedCases) {
    const outgoing = await source(test.bytes, true, 'qt', test.policy ?? rule, test.mime ?? mimeText);
    assert.equal(await probe(false, 'gtk', rule, test.mime ?? mimeText), 'DENIED', test.name + ' copy');
    assert.ok((await session(outgoing.handle as string)).blockedCopy > 0);
    await closeSource(outgoing);
    const incoming = await source(test.bytes, false, 'gtk', rule, test.mime ?? mimeText);
    assert.equal(await probe(true, 'qt', test.policy ?? rule, test.mime ?? mimeText), 'DENIED', test.name + ' paste');
    await closeSource(incoming);
    evidence.push({ deniedBeforeBody: test.name, directions: ['copy', 'paste'] });
    console.log('Native body rejection passed:', test.name);
  }

  const outgoing = await source(normal, true);
  const outgoingId = outgoing.handle as string;
  await configure(outgoingId, { ...rule, copy: false }, 2);
  assert.equal(await probe(false, 'gtk'), 'DENIED');
  await configure(outgoingId, rule, 3);
  assert.equal(await probe(false, 'gtk'), normal.toString('hex'));
  const unpublished = Buffer.from('new owned body that has never been released');
  await upload(outgoing.input, unpublished, 0o644);
  await configure(outgoingId, { ...rule, copy: false }, 3);
  const beforeClosed = await brokerStatus(outgoingId);
  const afterTightening = await probe(false, 'qt');
  const afterClosed = await brokerStatus(outgoingId);
  assert.notEqual(afterTightening, unpublished.toString('hex'), 'Tightened source published never-released body');
  assert.ok(afterTightening === 'DENIED' || afterTightening === normal.toString('hex'));
  console.log('After tightening, previously released selection cache boundary:', {
    previouslyReleasedBytesReturned: afterTightening !== 'DENIED',
    unpublishedBytesReturned: false, blockedBefore: beforeClosed.blockedCopy, blockedAfter: afterClosed.blockedCopy,
    generation: afterClosed.generation, policySha256: afterClosed.policySha256,
  });
  evidence.push({ previouslyReleasedSelectionCacheAfterTightening: afterTightening !== 'DENIED',
    unpublishedBytesReturned: false, beforeBlockedCopy: beforeClosed.blockedCopy, afterBlockedCopy: afterClosed.blockedCopy });
  await upload(outgoing.input, normal, 0o644);
  await configure(outgoingId, rule, 3, false);
  assert.equal(await probe(false, 'gtk'), normal.toString('hex'));
  await configure(outgoingId, rule, 4);
  assert.equal(await probe(false, 'qt'), normal.toString('hex'));
  await closeSource(outgoing);
  const incoming = await source(normal, false, 'qt');
  assert.equal(await probe(true, 'gtk', { ...rule, paste: false }), 'DENIED');
  assert.equal(await probe(true, 'qt'), normal.toString('hex'));
  await closeSource(incoming);
  evidence.push({ hotCopyDirection: true, pasteDirection: true, sameGenerationObservation: true, disableRestore: true });
  console.log('Direction, same-generation rules and disabling passed');

  const binary = Buffer.from([0, 1, 2, 3, 0xff, 0x42]);
  const binarySource = await source(binary, true, 'qt', { ...rule, files: true, sensitive: false }, 'application/octet-stream');
  assert.equal(await probe(false, 'gtk', rule, 'application/octet-stream'), binary.toString('hex'));
  await closeSource(binarySource);
  const binaryIncoming = await source(binary, false, 'gtk', rule, 'application/octet-stream');
  assert.equal(await probe(true, 'qt', { ...rule, files: true, sensitive: false }, 'application/octet-stream'), binary.toString('hex'));
  await closeSource(binaryIncoming);
  evidence.push({ permittedNonTextFifo: true });

  const slowSource = await source(normal, true, 'qt', rule, mimeText, 'CLIPBOARD', 400);
  assert.equal(await probe(false, 'gtk'), normal.toString('hex'));
  await closeSource(slowSource);
  const timedSource = await source(normal, true, 'qt', rule, mimeText, 'CLIPBOARD', 1_200);
  assert.equal(await probe(false, 'gtk'), 'DENIED');
  await closeSource(timedSource);
  evidence.push({ nativeDelayedSourceMs: { accepted: 400, denied: 1_200 } });
  console.log('Slow native Qt source bounded collection passed');

  const collecting = await source(normal, true, 'qt', rule, mimeText, 'CLIPBOARD', 600);
  const collectingId = collecting.handle as string, pendingMarker = project + '/pending-' + (++serial);
  const waiting = await direct('gtk', ['probe', '/dev/null', pendingMarker, mimeText]);
  const pendingRequest = Buffer.from(JSON.stringify({ owner, action: 'configure', id: collectingId,
    rule: { ...rule, copy: false }, generation: 2, enabled: true })).toString('base64');
  const pendingStatus = '/var/lib/sakura/wayland-clipboard/' + owner + '/' + collectingId + '/status';
  const pendingEvidence = JSON.parse(await run(`/usr/bin/python3 -I -S -c ${quote(`import json,time,subprocess
deadline=time.monotonic()+.5
while True:
 state=json.load(open(${JSON.stringify(pendingStatus)}))
 if state['pending']>0: break
 assert time.monotonic()<deadline,'no actual pending native source'
 time.sleep(.01)
r=subprocess.run(['/usr/bin/python3','-I','-S',${JSON.stringify(controller)},${JSON.stringify(pendingRequest)}],capture_output=True,text=True,timeout=3)
assert r.returncode==0,r.stdout
latest=json.load(open(${JSON.stringify(pendingStatus)}))
assert latest['pending']==0 and latest['blockedCopy']>state['blockedCopy'],latest
print(json.dumps({'pendingBefore':state['pending'],'pendingAfter':latest['pending'],'generation':latest['generation']}))`)}`));
  assert.equal(await marker(pendingMarker), 'DENIED');
  await stopDirect(waiting); await closeSource(collecting);
  evidence.push({ livePendingTightening: pendingEvidence });
  console.log('Actual pending native source cancelled by observed tightening:', pendingEvidence);

  const childIncoming = await source(normal, false, 'gtk');
  const childMarker = project + '/child-' + (++serial);
  const childId = await launch(['child', '/dev/null', childMarker, mimeText]);
  await focus();
  assert.equal(await marker(childMarker), normal.toString('hex'));
  const childView = await session(childId);
  assert.ok(childView.processes.filter((item: { loaded: boolean }) => item.loaded).length >= 2);
  await stop(childId);
  await closeSource(childIncoming);
  await run(`test ! -e ${quote('/sys/fs/cgroup/sakura-wayland-app-' + owner.replaceAll('-', '') + '-' + childId.replaceAll('-', ''))}\ntest ! -e ${quote('/sys/fs/cgroup/sakura-wayland-broker-' + owner.replaceAll('-', '') + '-' + childId.replaceAll('-', ''))}`);
  evidence.push({ freshQtChildNativeConnection: true, childCgroupCleanup: true });
  console.log('Fresh child native connection and complete cgroup cleanup passed');

  const identitySource = await source(normal, true);
  const identityId = identitySource.handle as string;
  const identityDirectory = '/var/lib/sakura/wayland-clipboard/' + owner + '/' + identityId;
  console.log('Private endpoint identity denial:', await run(`/usr/bin/python3 -I -S -c ${quote(`import json,os,socket,struct,subprocess,sys
s=json.load(open(${JSON.stringify(identityDirectory + '/session.json')}))
program="import socket,sys;s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.settimeout(2);s.connect(sys.argv[1]);assert s.recv(32)==b''"
for uid in (0,s['uid']):
 def drop():
  os.setgroups([]);os.setgid(s['gid'] if uid else 0);os.setuid(uid)
 result=subprocess.run(['/usr/bin/python3','-I','-S','-c',program,s['socket']],preexec_fn=drop,capture_output=True,timeout=3)
 assert result.returncode==0,'unauthorized endpoint accepted: '+str(uid)
print('root and same app UID outside registered cgroup rejected')`)}`));
  const privateStatus = await brokerStatus(identityId);
  assert.equal(privateStatus.pending, 0);
  assert.ok(!JSON.stringify(privateStatus).includes(normal.toString()));
  await closeSource(identitySource);
  evidence.push({ unauthorizedUidAndCgroupDenied: true, statusHasNoClipboardBody: true });

  const globals = JSON.parse(await run(`/usr/bin/python3 -I -S -c ${quote(`import socket,struct,json
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.settimeout(2);s.connect(${JSON.stringify(guestRoot + '/compositor/wayland-owned')})
s.sendall(struct.pack('=III',1,(12<<16)|1,2)+struct.pack('=III',1,12<<16,3));buffer=b'';names=[];done=False
while not done:
 chunk=s.recv(65536);assert chunk;buffer+=chunk
 while len(buffer)>=8:
  ident,word=struct.unpack_from('=II',buffer);size=word>>16;assert 8<=size<=65535
  if len(buffer)<size:break
  raw=buffer[:size];buffer=buffer[size:]
  if ident==2 and word&65535==0:
   length=struct.unpack_from('=I',raw,12)[0];names.append(raw[16:16+length-1].decode())
  if ident==3:done=True
print(json.dumps(names))`)}`));
  const primarySupported = globals.includes('zwp_primary_selection_device_manager_v1');
  if (primarySupported) {
    for (const [from, to] of [['qt', 'gtk'], ['gtk', 'qt']] as const) {
      const primarySource = await source(normal, true, from, rule, mimeText, 'PRIMARY');
      assert.equal(await probe(false, to, rule, mimeText, 'PRIMARY'), normal.toString('hex'));
      await closeSource(primarySource);
      const primaryIncoming = await source(normal, false, from, rule, mimeText, 'PRIMARY');
      assert.equal(await probe(true, to, rule, mimeText, 'PRIMARY'), normal.toString('hex'));
      await closeSource(primaryIncoming);
    }
    console.log('Native primary selection Qt↔GTK both directions passed');
  } else console.log('Owned compositor does not advertise native primary selection; no unsupported success claimed');
  evidence.push({ compositorGlobals: globals, primarySelectionVerified: primarySupported });
  console.log('Native Wayland expanded regression passed; build:', build);

  // Exercise the real public service and production desktop discovery next.
  // Stop only this fixture's desktop UID before the Sakura service owns it.
  const workspaces = new Workspaces(machines);
  desktops = new Desktops(machines, workspaces);
  await desktops.stop(vm.id);
  await workspaces.save(vm.id, { directory: project, networkIsolation: 'host',
    environment: { SAKURA_WAYLAND_TEST_VALUE: 'owned-native-wayland-fixture' } });
  desktops.start(vm.id, 'start', { sessionType: 'wayland', resolution: '1280x800', animations: false });
  const plasmaDeadline = Date.now() + 1_000_000;
  let lastPlasmaProgress = 0;
  for (;;) {
    const desktop = await desktops.view(vm.id);
    assert.notEqual(desktop.status, 'error', desktop.error + '\n' + desktop.log);
    if (desktop.status === 'ready') {
      assert.equal(desktop.preferences?.sessionType, 'wayland'); break;
    }
    if (Date.now() - lastPlasmaProgress > 15_000) {
      console.log('Owned production Plasma progress:', desktop.status, desktop.log.slice(-1000));
      lastPlasmaProgress = Date.now();
    }
    assert.ok(Date.now() < plasmaDeadline, 'Owned production native Plasma startup timed out');
    await delay(1000);
  }
  console.log('Sakura desktop v5 native Plasma ready:', await run('cat /etc/sakura/desktop-version\npgrep -a -u sakura-desktop kwin_wayland'));
  const assets = join(directory, 'wayland-assets-' + nonce);
  await mkdir(assets);
  for (const file of files) await writeFile(join(assets, file.name), file.bytes);
  await writeFile(join(assets, 'manifest.json'), JSON.stringify({ version: 1, build,
    files: files.map((file) => ({ name: file.name, size: file.bytes.length, sha256: createHash('sha256').update(file.bytes).digest('hex') })) }));
  production = new WaylandClipboard(machines, async () => {
    const binding = await new DesktopBindings(machines).read(vm.id); assert.ok(binding);
    return { project: await workspaces.resolvedConfig(vm.id), launcherSha256: binding.launcherSha256 };
  }, { assets, file: () => join(directory, 'wayland-production-' + nonce + '.json'), jobsDirectory: join(directory, 'wayland-jobs-' + nonce) });
  const install = production.install(vm.id), installDeadline = Date.now() + 300_000;
  for (;;) {
    const view = await production.view(vm.id);
    assert.ok(!view.error, view.error);
    if (view.installation?.status === 'error') throw Error(view.installation.error || view.installation.log);
    if (view.ready && view.installation?.status === 'done') break;
    assert.ok(Date.now() < installDeadline, 'Owned public Wayland installation timed out');
    await delay(250);
  }
  assert.ok(install.id);
  const publicIdentity = await production.action(vm.id, { action: 'identify', image: programDirectory + '/fixture-qt' }) as { image: string; sha256: string };
  let publicView = await production.view(vm.id);
  publicView = await production.action(vm.id, { action: 'save', version: publicView.version,
    application: { ...publicIdentity, rule } }) as X11ClipboardView;
  assert.ok(!publicView.error, publicView.error);
  const productionFocus = async () => run('sleep .4\nenv DISPLAY=:1 XAUTHORITY=/run/sakura-desktop/Xauthority xdotool mousemove 640 400 click 1 key F8');
  const publicInput = await bodyFile(normal), publicReady = project + '/public-ready-' + (++serial);
  const publicSource = await production.action(vm.id, { action: 'launch', version: publicView.version,
    image: publicIdentity.image, args: ['owner', publicInput, publicReady, mimeText] }) as X11ClipboardSession;
  productionSessions.push(publicSource.id);
  assert.equal(publicSource.state, 'running', publicSource.error);
  await productionFocus(); assert.match(await marker(publicReady), /^READY wayland/);
  const publicMarker = project + '/public-result-' + (++serial);
  const publicSink = await production.action(vm.id, { action: 'launch', version: publicView.version,
    image: publicIdentity.image, args: ['probe', '/dev/null', publicMarker, mimeText] }) as X11ClipboardSession;
  productionSessions.push(publicSink.id);
  assert.equal(publicSink.state, 'running', publicSink.error);
  await productionFocus(); assert.equal(await marker(publicMarker), normal.toString('hex'));
  const publicState = JSON.parse(await readFile(join(directory, 'wayland-production-' + nonce + '.json'), 'utf8'));
  const publicMetadata = JSON.parse(await run(`cat ${quote('/var/lib/sakura/wayland-clipboard/' + publicState.owner + '/' + publicSource.id + '/session.json')}`));
  assert.equal(publicMetadata.build, build);
  assert.ok(publicMetadata.compositorSocket.startsWith('/run/sakura-desktop/'));
  assert.notEqual(publicMetadata.uid, publicMetadata.compositorUid);
  upstreamSocket = publicMetadata.compositorSocket;
  focusDisplay = ':1'; focusAuthority = '/run/sakura-desktop/Xauthority';
  for (const id of productionSessions) await production.action(vm.id, { action: 'stop', id });
  evidence.push({ productionDesktopVersion: 5, productionSessionType: 'wayland',
    publicWaylandClipboardInstall: true, publicWaylandClipboardCopyPaste: true, automaticCompositorDiscovery: true, build });
  console.log('Real Sakura desktop v5 + public native Wayland service discovery/copy/paste passed');
  const gtkIdentity = await production.action(vm.id, { action: 'identify', image: programDirectory + '/fixture-gtk' }) as { image: string; sha256: string };
  publicView = await production.view(vm.id);
  publicView = await production.action(vm.id, { action: 'save', version: publicView.version,
    application: { ...gtkIdentity, rule } }) as X11ClipboardView;
  const publicLaunch = async (toolkit: Toolkit, args: string[]) => {
    const view = await production!.view(vm.id);
    const item = await production!.action(vm.id, { action: 'launch', version: view.version,
      image: toolkit === 'qt' ? publicIdentity.image : gtkIdentity.image, args }) as X11ClipboardSession;
    productionSessions.push(item.id); assert.equal(item.state, 'running', item.error);
    await focus(); return item.id;
  };
  for (const [from, to] of [['qt', 'gtk'], ['gtk', 'qt']] as const) {
    const primaryText = Buffer.from('Native KWin primary ' + from + '-' + to + ' ' + nonce);
    const primaryInput = await bodyFile(primaryText), primaryReady = project + '/kwin-primary-ready-' + (++serial);
    const primarySourceId = await publicLaunch(from, ['owner', primaryInput, primaryReady, mimeText, 'PRIMARY']);
    assert.match(await marker(primaryReady), /^READY (?:wayland|gtk-wayland)/);
    assert.equal(await probe(false, to, rule, mimeText, 'PRIMARY'), primaryText.toString('hex'));
    await production.action(vm.id, { action: 'stop', id: primarySourceId });
    const directPrimary = await source(primaryText, false, from, rule, mimeText, 'PRIMARY');
    const primaryMarker = project + '/kwin-primary-result-' + (++serial);
    const primarySinkId = await publicLaunch(to, ['probe', '/dev/null', primaryMarker, mimeText, 'PRIMARY']);
    assert.equal(await marker(primaryMarker), primaryText.toString('hex'));
    await production.action(vm.id, { action: 'stop', id: primarySinkId });
    await closeSource(directPrimary);
    evidence.push({ productionKWinPrimaryCopyAndPaste: [from, to] });
    console.log('Real KWin primary selection public service both directions:', from, '→', to);
  }
  evidence.push({ discoveredProductionCompositor: {
    socket: publicMetadata.compositorSocket, pid: publicMetadata.compositorPid,
    created: publicMetadata.compositorCreated, uid: publicMetadata.compositorUid,
  } });

  await desktops.stop(vm.id);
  await workspaces.save(vm.id, { directory: project, networkIsolation: 'private',
    environment: { SAKURA_WAYLAND_TEST_VALUE: 'owned-private-native-wayland-fixture' } });
  desktops.start(vm.id, 'start', { sessionType: 'wayland', resolution: '1280x800', animations: false });
  const privateDeadline = Date.now() + 180_000;
  for (;;) {
    const view = await desktops.view(vm.id);
    assert.notEqual(view.status, 'error', view.error + '\n' + view.log);
    if (view.status === 'ready') break;
    assert.ok(Date.now() < privateDeadline, 'Owned private native Plasma startup timed out');
    await delay(1000);
  }
  const privateText = Buffer.from('Fresh native private-project正文 ' + nonce);
  const privateInput = await bodyFile(privateText), privateReady = project + '/private-ready-' + (++serial);
  const privateSourceId = await publicLaunch('qt', ['owner', privateInput, privateReady, mimeText]);
  assert.match(await marker(privateReady), /^READY wayland/);
  const privateMarker = project + '/private-result-' + (++serial);
  const privateSinkId = await publicLaunch('gtk', ['probe', '/dev/null', privateMarker, mimeText]);
  assert.equal(await marker(privateMarker), privateText.toString('hex'));
  const privateSessionDirectory = '/var/lib/sakura/wayland-clipboard/' + publicState.owner + '/' + privateSourceId;
  const privateMetadata = JSON.parse(await run(`cat ${quote(privateSessionDirectory + '/session.json')}`));
  assert.notEqual(privateMetadata.network, await run('readlink /proc/1/ns/net'));
  assert.equal(privateMetadata.compositorImage, '/usr/bin/kwin_wayland_wrapper');
  assert.ok(privateMetadata.compositorChildPid > 0 && /^[0-9]+$/.test(privateMetadata.compositorChildCreated));
  await production.action(vm.id, { action: 'stop', id: privateSinkId });
  evidence.push({ publicPrivateProjectNativeCopyPaste: true, privateNetwork: privateMetadata.network,
    creatorPid: privateMetadata.compositorPid, childPid: privateMetadata.compositorChildPid });
  console.log('Public native Wayland in real private project network passed');

  const actorChange = JSON.parse(await run(`/usr/bin/python3 -I -S -c ${quote(`import json,os,signal,time
path=${JSON.stringify(privateSessionDirectory)}
s=json.load(open(path+'/session.json'));creator=s['compositorPid'];child=s['compositorChildPid']
def identity(pid):
 raw=open('/proc/'+str(pid)+'/stat').read();f=raw[raw.rfind(')')+2:].split()
 return f[19],int(f[1]),os.readlink('/proc/'+str(pid)+'/exe')
assert identity(creator)[0]==s['compositorCreated'] and identity(creator)[2]==s['compositorImage']
assert identity(child)==(s['compositorChildCreated'],creator,'/usr/bin/kwin_wayland')
assert os.readlink('/proc/'+str(child)+'/fd/'+str(s['compositorChildFd']))=='socket:['+str(s['compositorKernelInode'])+']'
os.kill(child,signal.SIGKILL)
deadline=time.monotonic()+5;replacement=None
while time.monotonic()<deadline:
 state=json.load(open(path+'/status'))
 assert identity(creator)[0]==s['compositorCreated']
 for value in open('/proc/'+str(creator)+'/task/'+str(creator)+'/children').read().split():
  try:
   pid=int(value);start,parent,image=identity(pid)
   if pid!=child and parent==creator and image=='/usr/bin/kwin_wayland':replacement=pid
  except FileNotFoundError:pass
 if not state['ready'] and replacement:break
 time.sleep(.025)
assert not state['ready'] and state['pending']==0 and replacement,state
assert json.load(open(path+'/session.json'))['compositorChildPid']==child
print(json.dumps({'creatorStayedPinned':creator,'originalChild':child,'replacementChild':replacement,'oldBrokerReady':state['ready'],'pending':state['pending']}))`)}`));
  const revoked = await production.view(vm.id);
  assert.notEqual(revoked.sessions.find((item) => item.id === privateSourceId)?.state, 'running');
  await production.action(vm.id, { action: 'stop', id: privateSourceId });
  evidence.push({ ownedKWinChildIdentityChanged: actorChange, oldBrokerDidNotFollowRespawn: true });
  console.log('Owned real KWin child replacement invalidated old broker:', actorChange);
  passed = true;
} catch (error) {
  failure = error instanceof Error ? error.message.slice(0, 512) : 'Unknown owned fixture failure';
  throw error;
} finally {
  if (production) {
    for (const id of productionSessions) await production.action(vm.id, { action: 'stop', id }).catch(() => {});
    await production.close();
  }
  if (desktops) {
    if (machines.live.has(vm.id)) {
      const diagnostic = await machines.exec(vm.id, 'tail -c 8000 /var/log/sakura-desktop.log', 10_000).catch(() => null);
      if (!passed && diagnostic?.stdout) console.log('Owned production native Plasma diagnostic:', diagnostic.stdout);
    }
    if (machines.live.has(vm.id)) await desktops.stop(vm.id).catch((error) => console.log('Owned Plasma cleanup:', String(error)));
    await desktops.close();
  }
  if (controller) for (const id of sessions) await action({ action: 'stop', id }).catch((error) => console.log('Owned session cleanup:', String(error)));
  if (machines.live.has(vm.id)) {
    for (const identity of directProcesses) await stopDirect(identity).catch(() => {});
    const diagnostics = await machines.exec(vm.id, `tail -c 10000 ${quote(guestRoot + '/compositor.log')} ${quote(guestRoot + '/direct.log')} 2>/dev/null`, 10_000).catch(() => null);
    if (diagnostics?.stdout) console.log('Owned compositor/native baseline diagnostics:', diagnostics.stdout);
    await machines.exec(vm.id, `set -eu\nfor name in direct compositor-launcher xvfb; do if test -f ${quote(guestRoot)}/"$name.pid"; then kill "$(cat ${quote(guestRoot)}/"$name.pid")" 2>/dev/null || true; fi; done\nsync`, 10_000).catch(() => {});
    await machines.stop(vm.id, true);
  }
  await machines.close();
  await writeFile(join(directory, 'native-wayland-evidence.json'), JSON.stringify({
    vmId: vm.id, directory, guestRoot, project, programDirectory,
    qtProgram: programDirectory + '/fixture-qt', qtSha256,
    gtkProgram: programDirectory + '/fixture-gtk', gtkSha256,
    build: sourceBuild, sourceFiles, passed, error: failure ?? null,
    vmStopped: machines.state(vm.id) === 'stopped', finishedAt: new Date().toISOString(), evidence,
  }, null, 2));
  console.log('Retained stopped owned native Wayland fixture:', directory);
}
