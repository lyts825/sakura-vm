import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const distro = process.env.SAKURA_TEST_DISTRO || 'alpine';
assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro), 'unsupported smoke distro');
const imageName = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2',
  ubuntu: 'ubuntu-24.04.qcow2' }[distro]!;
const directory = await mkdtemp(join(tmpdir(), 'sakura-single-app-'));
await mkdir(join(directory, 'images'), { recursive: true });
await copyFile(resolve('.data/images', imageName), join(directory, 'images', imageName));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = join(directory, 'images');
process.env.SAKURA_IMAGE_PATH = join(directory, 'images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Desktops } = await import('../server/desktop.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const desktops = new Desktops(machines);
try {
  const vm = await machines.create({ name: `single-app-${distro}`, distro: distro as
    'alpine' | 'debian' | 'ubuntu', memoryMiB: 1024, cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 300_000;
  while (machines.state(vm.id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(vm.id)))
      throw new Error(machines.logs.get(vm.id));
    await delay(250);
  }
  const session = await desktops.apps.start(vm.id, { program: 'xterm',
    args: ['-hold', '-e', 'sh', '-c', 'sleep 120'],
    clipboard: { copy: false, paste: false } });
  const other = await desktops.apps.start(vm.id, { program: 'xterm',
    args: ['-hold', '-e', 'sh', '-c', 'sleep 120'] });
  assert.notEqual(other.port, session.port);
  assert.equal(await desktops.apps.port(vm.id, session.id), session.port);
  const handshake = await machines.exec(vm.id,
    `timeout 5 sh -c 'nc 127.0.0.1 ${session.port} | head -c 12'`, 10000);
  assert.match(handshake.stdout, /^RFB 003\./, JSON.stringify(handshake));
  const clipboard = await machines.exec(vm.id, `set -eu
auth=$(find /tmp/sakura-single-app-${session.id.slice(0, 12)}.* -maxdepth 1 -name Xauthority -print -quit)
test -n "$auth"
config=$(command -v vncconfig || command -v tigervncconfig)
DISPLAY=:${session.display} XAUTHORITY="$auth" "$config" -get SendCutText
DISPLAY=:${session.display} XAUTHORITY="$auth" "$config" -get AcceptCutText
DISPLAY=:${session.display} XAUTHORITY="$auth" "$config" -set AcceptCutText=1 >/dev/null 2>&1 || true
DISPLAY=:${session.display} XAUTHORITY="$auth" "$config" -get AcceptCutText`, 10000);
  assert.equal(clipboard.code, 0, clipboard.stderr);
  assert.deepEqual(clipboard.stdout.trim().split(/\s+/).map((value) =>
    value === 'off' ? '0' : value), ['0', '0', '0']);
  const otherClipboard = await machines.exec(vm.id, `set -eu
auth=$(find /tmp/sakura-single-app-${other.id.slice(0, 12)}.* -maxdepth 1 -name Xauthority -print -quit)
test -n "$auth"
config=$(command -v vncconfig || command -v tigervncconfig)
DISPLAY=:${other.display} XAUTHORITY="$auth" "$config" -get SendCutText
DISPLAY=:${other.display} XAUTHORITY="$auth" "$config" -get AcceptCutText`, 10000);
  assert.equal(otherClipboard.code, 0, otherClipboard.stderr);
  assert.deepEqual(otherClipboard.stdout.trim().split(/\s+/).map((value) =>
    value === 'on' ? '1' : value), ['1', '1']);
  await desktops.apps.saveClipboardPolicy(vm.id, 'xterm', { copy: false, paste: false });
  assert.deepEqual((await desktops.apps.clipboardPolicies(vm.id)).xterm,
    { copy: false, paste: false });
  const governed = await desktops.apps.start(vm.id, { program: 'xterm',
    args: ['-hold', '-e', 'sh', '-c', 'sleep 120'],
    clipboard: { copy: true, paste: true } });
  assert.deepEqual(governed.clipboard, { copy: false, paste: false },
    'saved per-program rule cannot be widened by a launch request');
  const governedClipboard = await machines.exec(vm.id, `set -eu
auth=$(find /tmp/sakura-single-app-${governed.id.slice(0, 12)}.* -maxdepth 1 -name Xauthority -print -quit)
test -n "$auth"
config=$(command -v vncconfig || command -v tigervncconfig)
DISPLAY=:${governed.display} XAUTHORITY="$auth" "$config" -get SendCutText
DISPLAY=:${governed.display} XAUTHORITY="$auth" "$config" -get AcceptCutText`, 10000);
  assert.equal(governedClipboard.code, 0, governedClipboard.stderr);
  assert.deepEqual(governedClipboard.stdout.trim().split(/\s+/).map((value) =>
    value === 'off' ? '0' : value), ['0', '0']);
  assert.equal((await desktops.apps.list(vm.id)).filter((item) => item.status === 'running').length, 3);
  await desktops.apps.stop(vm.id, session.id);
  await delay(500);
  const stopped = await machines.exec(vm.id,
    `! nc -z 127.0.0.1 ${session.port} >/dev/null 2>&1`, 5000);
  assert.equal(stopped.code, 0, stopped.stderr);
  assert.equal(await desktops.apps.port(vm.id, other.id), other.port);
  await desktops.apps.stop(vm.id, governed.id);
  await desktops.apps.stop(vm.id, other.id);
  await desktops.apps.removeClipboardPolicy(vm.id, 'xterm');
  assert.equal((await desktops.apps.clipboardPolicies(vm.id)).xterm, undefined);
  console.log(`Real ${distro} independent single-app Xvnc sessions, saved clipboard rule, RFB handshake and cleanup passed`);
} finally {
  await desktops.close();
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-single-app-'));
  await rm(directory, { recursive: true, force: true });
}
