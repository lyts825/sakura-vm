import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';

const distro = process.argv[2] || 'alpine';
const images: Record<string, string> = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' };
assert.ok(images[distro]);
const directory = process.env.SAKURA_DESKTOP_SMOKE_REUSE ? resolve(process.env.SAKURA_DESKTOP_SMOKE_REUSE)
  : await mkdtemp(join(tmpdir(), 'sakura-project-desktop-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith('sakura-project-desktop-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images', images[distro]);
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Desktops } = await import('../server/desktop.ts');
const { DesktopBindings, desktopLauncherPath } = await import('../server/desktop-binding.ts');
const { projectNetworkCommand } = await import('../server/project-network-isolation.ts');
const { createServer } = await import('vite');
const { chromium } = await import('@playwright/test');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);
let desktops = new Desktops(machines, workspaces);
const bindings = new DesktopBindings(machines);
let preview: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let bridge: WebSocketServer | undefined;
let active = 'default';
let completed = false;
console.log('KDE smoke fixture:', directory);

async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 300000;
  while (machines.state(id) !== 'running') {
    assert.ok(Date.now() < deadline && machines.state(id) === 'starting', machines.logs.get(id));
    await delay(300);
  }
}
async function ready(id: string, project: string, timeout = 190000) {
  const deadline = Date.now() + timeout;
  let lastLog = '';
  let stoppedAt = 0;
  while (true) {
    const view = await workspaces.projects.with(id, project, () => desktops.view(id));
    if (view.log !== lastLog) {
      console.log(view.log.startsWith(lastLog) ? view.log.slice(lastLog.length) : view.log.slice(-1024));
      lastLog = view.log;
    }
    assert.notEqual(view.status, 'error', view.error + '\n' + view.log);
    if (view.status === 'stopped') {
      stoppedAt ||= Date.now();
      assert.ok(Date.now() - stoppedAt < 30000, `KDE service stopped after the operation: ${JSON.stringify(view)}`);
    } else stoppedAt = 0;
    if (view.status === 'ready') {
      assert.equal(view.projectId, project);
      assert.equal(view.bindingMismatch, undefined);
      return view;
    }
    assert.ok(Date.now() < deadline, JSON.stringify(view));
    await delay(800);
  }
}

try {
  const vm = [...machines.records.values()][0] || await machines.create({ name: `project-desktop-${distro}`, distro,
    memoryMiB: 2048, cpus: 2, diskGiB: 8 });
  await boot(vm.id);
  await workspaces.save(vm.id, { directory: '/workspace/shared' });
  const index = await workspaces.projects.list(vm.id);
  const alpha = index.projects.find((entry) => entry.name === 'Desktop private')?.id ||
    (await workspaces.projects.create(vm.id, 'Desktop private', async () => {
    await workspaces.save(vm.id, { directory: '/workspace/desktop-private', networkIsolation: 'private',
      environment: { SAKURA_GUI_SCOPE: 'desktop-alpha', HOME: '/root', DISPLAY: ':99' } });
  })).active;
  const beta = index.projects.find((entry) => entry.name === 'Other private')?.id ||
    (await workspaces.projects.create(vm.id, 'Other private', async () => {
    await workspaces.save(vm.id, { directory: '/workspace/desktop-other', networkIsolation: 'private' });
  })).active;
  active = alpha;
  await workspaces.projects.with(vm.id, alpha, async () => { desktops.start(vm.id, 'install'); });
  await ready(vm.id, alpha, 940000);
  const project = await workspaces.projects.with(vm.id, alpha, () => workspaces.config(vm.id));
  const network = (command: string) => projectNetworkCommand(project, command);
  const boundary = await machines.exec(vm.id, `set -eu
expected=$(ip netns exec sk-${alpha} readlink /proc/self/ns/net)
test "$expected" != "$(readlink /proc/self/ns/net)"
for pid in $(pgrep -u sakura-desktop); do
  actual=$(readlink /proc/"$pid"/ns/net) || continue
  test "$actual" = "$expected"
done
! nc -z 127.0.0.1 5901
${network('nc -z 127.0.0.1 5901')}
test "$(stat -c %a ${desktopLauncherPath})" = 700
${distro === 'alpine' ? '! test -e /etc/runlevels/default/sakura-desktop' : '! systemctl is-enabled sakura-desktop'}
printf '%s\n' "$expected"`, 10000);
  assert.equal(boundary.code, 0, boundary.stdout + boundary.stderr);
  const expectedNamespace = boundary.stdout.trim().split('\n').at(-1)!;
  await workspaces.projects.with(vm.id, alpha, async () => {
    await assert.rejects(workspaces.save(vm.id, { ...project, networkIsolation: 'host' }), /停止/);
    await assert.rejects(workspaces.save(vm.id, { ...project, directory: '/workspace/changed' }), /停止/);
  });
  const wrongScope = await workspaces.projects.with(vm.id, beta, () => desktops.view(vm.id));
  assert.equal(wrongScope.bindingMismatch, true);

  bridge = new WebSocketServer({ noServer: true });
  bridge.on('connection', (socket, request) => {
    const url = new URL(request.url!, 'http://localhost');
    void desktops.attach(vm.id, socket, url.pathname.endsWith('desktop-view'), 5901, undefined,
      url.searchParams.get('project')).catch(() => socket.close());
  });
  preview = await createServer({ cacheDir: join(directory, 'vite-cache'),
    optimizeDeps: { entries: ['src/DesktopPanel.tsx'], include: ['react', 'react-dom/client'] },
    server: { host: '127.0.0.1', port: 0 }, plugins: [{
      name: 'project-desktop-smoke',
      resolveId(id) { if (id === '/desktop-project-smoke.tsx') return id; },
      load(id) {
        if (id !== '/desktop-project-smoke.tsx') return;
        return `import React from 'react';
import {createRoot} from 'react-dom/client';
import {DesktopPanel} from '/src/DesktopPanel.tsx';
const request = async (path,method='GET',body,signal) => {
  const response = await fetch('/api'+path,{method,signal,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const value = await response.json(); if(!response.ok) throw Error(value.error);return value;
};
createRoot(document.getElementById('root')).render(React.createElement(DesktopPanel,{
  vm:${JSON.stringify({ ...vm, status: 'running', startedAt: machines.live.get(vm.id)!.startedAt })},
  token:'desktop-smoke',request,start:()=>{},configure:()=>{},busy:false
}));`;
      },
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const url = new URL(request.url!, 'http://localhost');
          if (url.pathname === '/desktop-smoke') {
            response.setHeader('Content-Type', 'text/html');
            const html = '<!doctype html><meta charset="UTF-8"><div id="root"></div>' +
              '<script type="module" src="/desktop-project-smoke.tsx"></script>';
            void server.transformIndexHtml('/desktop-smoke', html).then((content) => response.end(content),
              (error) => { response.statusCode = 500; response.end(error.message); });
            return;
          }
          if (url.pathname === `/api/vms/${vm.id}/desktop`) {
            void workspaces.projects.with(vm.id, active, async () => {
              if (request.method === 'GET') return desktops.view(vm.id);
              let input = ''; for await (const chunk of request) input += chunk;
              const { action, preferences } = JSON.parse(input);
              return action === 'stop' ? desktops.stop(vm.id) : desktops.start(vm.id, action, preferences);
            }).then((value) => {
              response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value));
            }, (error) => { response.statusCode = 409; response.end(JSON.stringify({ error: error.message })); });
            return;
          }
          if (url.pathname === `/api/vms/${vm.id}/ime`) {
            response.setHeader('Content-Type', 'application/json'); response.end('null'); return;
          }
          next();
        });
      },
    }] });
  preview.httpServer!.on('upgrade', (request, socket, head) => {
    if (!request.url?.startsWith(`/ws/${vm.id}/`)) return;
    bridge!.handleUpgrade(request, socket, head, (ws) => bridge!.emit('connection', ws, request));
  });
  await preview.listen();
  const address = preview.httpServer!.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const denied = new WebSocket(`${base.replace('http:', 'ws:')}/ws/${vm.id}/desktop?project=${beta}`);
  denied.on('error', () => {});
  await once(denied, 'close', { signal: AbortSignal.timeout(15000) });
  const viewer = new WebSocket(`${base.replace('http:', 'ws:')}/ws/${vm.id}/desktop-view`);
  viewer.on('error', () => {});
  const [banner] = await once(viewer, 'message', { signal: AbortSignal.timeout(15000) });
  assert.equal(banner.toString(), 'RFB 003.008\n');
  viewer.terminate();

  await machines.writeGuestFile(vm.id, '/tmp/sakura-desktop-probe.sh', `#!/bin/sh
printf '%s\\n' "$(readlink /proc/self/ns/net)" "$SAKURA_GUI_SCOPE" "$HOME" "$DISPLAY" "$(id -u)" "$(pwd)" > "$HOME/project-gui-probe"
setsid sleep 600 &
echo $! > "$HOME/project-detached-pid"
sleep 600
`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', (error) => console.log('Browser error:', error.message));
  await page.goto(base + '/desktop-smoke');
  await page.locator('.desktop-title-copy').getByText('已连接', { exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await page.locator('.desktop-screen canvas').count(), 1);
  await page.locator('.desktop-screen canvas').click();
  await page.keyboard.press('Alt+F2');
  await delay(1500);
  await page.keyboard.type('konsole --separate -e /bin/sh /tmp/sakura-desktop-probe.sh', { delay: 30 });
  await page.keyboard.press('Enter');
  const probe = await machines.exec(vm.id, `set -eu
for attempt in $(seq 1 50); do test -s /home/sakura-desktop/project-gui-probe && break; sleep 0.3; done
cat /home/sakura-desktop/project-gui-probe
cat /home/sakura-desktop/project-detached-pid`, 20000);
  assert.equal(probe.code, 0, probe.stderr);
  const lines = probe.stdout.trim().split('\n');
  assert.equal(lines[0], expectedNamespace);
  assert.equal(lines[1], 'desktop-alpha');
  assert.equal(lines[2], '/home/sakura-desktop');
  assert.match(lines[3], /^:[0-9]+$/);
  assert.notEqual(lines[3], ':99');
  assert.ok(Number(lines[4]) >= 1000);
  const detached = Number(lines.at(-1));
  assert.ok(Number.isInteger(detached) && detached! > 0);
  await page.screenshot({ path: resolve(`.data/project-desktop-${distro}.png`), fullPage: true });
  const connected = new WebSocket(`${base.replace('http:', 'ws:')}/ws/${vm.id}/desktop?project=${alpha}`);
  connected.on('error', () => {});
  await once(connected, 'message', { signal: AbortSignal.timeout(15000) });
  const revoked = once(connected, 'close', { signal: AbortSignal.timeout(15000) });
  await page.getByRole('button', { name: '停止桌面', exact: true }).click();
  await page.getByRole('heading', { name: '桌面会话已停止' }).waitFor({ timeout: 40000 });
  await revoked;
  const cleaned = await machines.exec(vm.id,
    `! kill -0 ${detached} 2>/dev/null && ! pgrep -u sakura-desktop >/dev/null`, 10000);
  assert.equal(cleaned.code, 0, cleaned.stdout + cleaned.stderr);
  assert.equal((await bindings.read(vm.id))!.enabled, false);
  await browser.close(); browser = undefined;
  await preview.close(); preview = undefined;
  bridge.close(); bridge = undefined;
  console.log(`${distro}: real KDE, Konsole, private namespace, reserved environment, readonly/owner bridges and UI stop passed`);

  await workspaces.projects.with(vm.id, alpha, async () => { desktops.start(vm.id, 'start', { monitorLayout: 'dual-horizontal' }); });
  const dual = await ready(vm.id, alpha);
  assert.equal(dual.preferences!.monitorLayout, 'dual-horizontal');
  const monitors = await machines.exec(vm.id, network('env DISPLAY=:1 XAUTHORITY=/run/sakura-desktop/Xauthority xrandr --listmonitors'), 10000);
  assert.equal(monitors.code, 0, monitors.stderr);
  assert.match(monitors.stdout, /Monitors: 2/);
  await machines.stop(vm.id);
  await desktops.close();
  desktops = new Desktops(machines, workspaces);
  await boot(vm.id);
  await ready(vm.id, alpha);
  await desktops.close();
  desktops = new Desktops(machines, workspaces);
  await ready(vm.id, alpha);
  await machines.stop(vm.id);
  await workspaces.projects.with(vm.id, alpha, async () => {
    await workspaces.save(vm.id, { ...project, networkIsolation: 'host' });
  });
  assert.equal((await bindings.read(vm.id))!.enabled, false);
  await boot(vm.id);
  await delay(1500);
  assert.equal((await workspaces.projects.with(vm.id, alpha, () => desktops.view(vm.id))).status, 'stopped');
  await workspaces.projects.with(vm.id, beta, async () => { desktops.start(vm.id, 'start'); });
  await ready(vm.id, beta);
  await desktops.stop(vm.id);
  console.log(`${distro}: dual monitors, VM and controller restart, stopped-instance config change and project rebinding passed`);
  completed = true;
} finally {
  await browser?.close();
  for (const socket of bridge?.clients || []) socket.terminate();
  bridge?.close();
  await preview?.close();
  await desktops.close();
  await workspaces.close();
  await machines.close();
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith('sakura-project-desktop-'));
  if (completed || process.env.SAKURA_DESKTOP_KEEP_FAILURE !== '1')
    await rm(target, { recursive: true, force: true });
  else console.log('Retained failed KDE fixture:', target);
}
