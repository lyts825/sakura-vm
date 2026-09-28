import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-monitor-probe-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { desktopFramebufferSetup, desktopMonitorSetup } =
  await import('../server/desktop-guest.ts');
const { desktopCommands } = await import('../server/desktop-guest.ts');
const { defaultDesktopPreferences } = await import('../server/desktop-preferences.ts');
const fullDesktop = process.env.SAKURA_MONITOR_FULL_DESKTOP === '1';
const machines = new Machines(await createRuntime());
await machines.init();
try {
  const vm = await machines.create({ name: 'monitor-probe', memoryMiB: fullDesktop ? 2048 : 1024,
    cpus: 2, diskGiB: fullDesktop ? 8 : 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 300000;
  while (machines.state(vm.id) !== 'running') {
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(300);
  }
  const packageResult = await machines.exec(vm.id,
    'for attempt in 1 2 3; do apk add --no-cache --repository ' +
      'https://dl-cdn.alpinelinux.org/alpine/v3.23/community tigervnc xrandr xdpyinfo ' +
      '&& exit 0; sleep 2; done; exit 1',
    180000);
  assert.equal(packageResult.code, 0, packageResult.stdout + packageResult.stderr);
  for (const distro of ['alpine', 'debian', 'ubuntu']) {
    const scripts = desktopCommands(distro, { ...defaultDesktopPreferences,
      monitorLayout: 'dual-horizontal' });
    for (const key of ['install', 'configure', 'startWithPreferences'] as const) {
      const syntax = await machines.exec(vm.id,
        `sh -n <<'SAKURA_MONITOR_SYNTAX'\n${scripts[key]}\nSAKURA_MONITOR_SYNTAX`,
        10000);
      assert.equal(syntax.code, 0, `${distro} ${key}: ${syntax.stderr}`);
    }
  }
  for (const [index, layout, framebuffer, monitors, offset] of [
    [2, 'single', '1280 x 800', 1, ''],
    [3, 'dual-horizontal', '2560 x 800', 2, '+1280+0'],
    [4, 'dual-vertical', '1280 x 1600', 2, '+0+800'],
  ] as const) {
    const command = [
      'set -eu',
      'RESOLUTION=1280x800',
      `MONITOR_LAYOUT=${layout}`,
      desktopFramebufferSetup,
      `Xvnc :${index} -geometry "$FRAMEBUFFER" -depth 24 -rfbport ${5900 + index} -interface 127.0.0.1 -localhost -SecurityTypes None -nolisten tcp >/tmp/vnc-probe-${index}.log 2>&1 &`,
      'vnc_pid=$!',
      'trap "kill $vnc_pid 2>/dev/null || true" EXIT',
      `export DISPLAY=:${index}`,
      'for attempt in $(seq 1 40); do if xrandr --query >/dev/null 2>&1; then break; fi; sleep 0.25; done',
      desktopMonitorSetup,
      'xrandr --query | head -2',
      'xrandr --listmonitors',
    ].join('\n');
    const probe = await machines.exec(vm.id, command, 30000);
    assert.equal(probe.code, 0, probe.stdout + probe.stderr);
    assert.ok(probe.stdout.includes(`current ${framebuffer}`), probe.stdout);
    assert.ok(probe.stdout.includes(`Monitors: ${monitors}`), probe.stdout);
    if (offset) assert.ok(probe.stdout.includes(offset), probe.stdout);
  }
  if (fullDesktop) {
    const scripts = desktopCommands('alpine', { ...defaultDesktopPreferences,
      monitorLayout: 'dual-horizontal' });
    const installed = await machines.exec(vm.id, scripts.install, 920000);
    assert.equal(installed.code, 0, installed.stderr + installed.stdout.slice(-8000));
    const status = await machines.exec(vm.id, scripts.probe, 10000);
    assert.equal(status.stdout.trim(), 'ready', status.stderr);
    const monitors = await machines.exec(vm.id,
      'DISPLAY=:1 XAUTHORITY=/run/sakura-desktop/Xauthority xrandr --listmonitors', 10000);
    assert.equal(monitors.code, 0, monitors.stderr);
    assert.match(monitors.stdout, /Monitors: 2/);
    console.log('Full Alpine KDE desktop started with two RandR monitors:', monitors.stdout.trim());
  }
  console.log('Real Alpine Xvnc published one or two RandR monitors using production setup.');
} finally {
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-monitor-probe-'));
  await rm(directory, { recursive: true, force: true });
}
