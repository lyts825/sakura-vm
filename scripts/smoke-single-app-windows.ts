import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';

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
const { Workspaces } = await import('../server/workspaces.ts');
const { appIdentity } = await import('../server/single-app-sandbox.ts');
const { appIdentityScript, appVncFirewallScript } = await import('../server/single-app-sandbox.ts');
const { quote } = await import('../server/files.ts');
const { projectNetworkCommand } = await import('../server/project-network-isolation.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);
const desktops = new Desktops(machines, workspaces);
const privateNetwork = process.env.SAKURA_SINGLE_APP_PRIVATE === '1';
let browser: WebSocket | undefined;
let bridge: WebSocketServer | undefined;
let preview: { close(): Promise<void> } | undefined;
let webBrowser: { close(): Promise<void> } | undefined;
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
  await workspaces.save(vm.id, { networkIsolation: privateNetwork ? 'private' : 'host' });
  const project = await workspaces.config(vm.id);
  const network = (command: string) => projectNetworkCommand(project, command);
  const session = await desktops.apps.start(vm.id, { program: 'xterm',
    args: ['-hold', '-e', 'sh', '-c',
      'readlink /proc/self/ns/net > "$HOME/window.ns"; setsid sleep 600 & sleep 600'],
    clipboard: { copy: false, paste: false } });
  const other = await desktops.apps.start(vm.id, { program: 'xterm',
    args: ['-hold', '-e', 'sh', '-c', 'sleep 600'] });
  const python = await machines.exec(vm.id, 'command -v python3 >/dev/null || ' +
    (distro === 'alpine' ? 'apk add --no-cache python3' :
      'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3'), 120000);
  assert.equal(python.code, 0, python.stderr);
  const listener = `import socket,threading,time
def serve(family,address):
  listener=socket.socket(family)
  listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
  if family==socket.AF_INET6: listener.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,1)
  listener.bind((address,5901))
  listener.listen()
  while True:
    connection,_=listener.accept()
    connection.close()
threading.Thread(target=serve,args=(socket.AF_INET,"127.0.0.1"),daemon=True).start()
threading.Thread(target=serve,args=(socket.AF_INET6,"::1"),daemon=True).start()
time.sleep(600)`;
  const probe = await machines.exec(vm.id,
    `tmux new-session -d -s sakura-app-vnc-probe ${quote(network(`exec python3 -c ${quote(listener)}`))}`,
    10000);
  assert.equal(probe.code, 0, probe.stderr);
  await delay(1000);
  assert.notEqual(session.password, other.password);
  assert.equal(session.networkIsolation, privateNetwork ? 'private' : 'host');
  const identity = appIdentity(session.id), otherIdentity = appIdentity(other.id);
  for (const address of ['127.0.0.1', '::1']) {
    const connect = `python3 -c ${quote(`import socket;socket.create_connection((${JSON.stringify(address)},5901),1).close()`)}`;
    const root = await machines.exec(vm.id, network(connect), 5000);
    assert.equal(root.code, 0, `root bridge cannot connect to the ${address} fixture: ${root.stderr}`);
    const denied = await machines.exec(vm.id,
      network(`su ${identity.user} -s /bin/sh -c ${quote(connect)}`), 5000);
    assert.notEqual(denied.code, 0, `application bypassed the VNC firewall via ${address}`);
  }
  const ownVnc = await machines.exec(vm.id,
    network(`su ${identity.user} -s /bin/sh -c ${quote(`nc -z 127.0.0.1 ${session.port}`)}`), 5000);
  assert.equal(ownVnc.code, 0, ownVnc.stderr);
  const otherVnc = await machines.exec(vm.id,
    network(`su ${identity.user} -s /bin/sh -c ${quote(`nc -z 127.0.0.1 ${other.port}`)}`), 5000);
  assert.notEqual(otherVnc.code, 0, 'application connected to another window VNC port');
  const probeStopped = await machines.exec(vm.id,
    'tmux kill-session -t =sakura-app-vnc-probe', 5000);
  assert.equal(probeStopped.code, 0, probeStopped.stderr);
  const fake = randomUUID();
  const fakeIdentity = await machines.exec(vm.id, appIdentityScript(fake, distro === 'alpine'), 10000);
  assert.equal(fakeIdentity.code, 0, fakeIdentity.stderr);
  const fakeUid = Number(fakeIdentity.stdout.split('\n')[0]);
  const fakeChain = `SAP_${fake.replaceAll('-', '').slice(0, 16)}`;
  const collision = await machines.exec(vm.id,
    network(`iptables -w -N ${fakeChain}\niptables -w -A ${fakeChain} -j RETURN`), 10000);
  assert.equal(collision.code, 0, collision.stderr);
  const refused = await machines.exec(vm.id, network(appVncFirewallScript(fake, fakeUid, 5917)), 10000);
  assert.notEqual(refused.code, 0, 'a pre-existing firewall chain must not be reused');
  const preserved = await machines.exec(vm.id, network(`set -eu
iptables -w -C ${fakeChain} -j RETURN
iptables -w -F ${fakeChain}
iptables -w -X ${fakeChain}`), 10000);
  assert.equal(preserved.code, 0, 'foreign chain was modified by a failed launch');
  const rolledBack = await machines.exec(vm.id, network(`ip6tables() {
  if test "$1" = -w && test "$2" = -N; then return 1; fi
  command ip6tables "$@"
}
${appVncFirewallScript(fake, fakeUid, 5917)}`), 10000);
  assert.notEqual(rolledBack.code, 0, 'the injected second-family failure must fail closed');
  const cleared = await machines.exec(vm.id, network(
    `! iptables -w -S ${fakeChain} >/dev/null 2>&1 && ! ip6tables -w -S ${fakeChain} >/dev/null 2>&1`),
    10000);
  assert.equal(cleared.code, 0, 'first-family rules must be rolled back after the second family fails');
  const boundary = await machines.exec(vm.id, `set -eu
test "$(id -u ${identity.user})" != "$(id -u ${otherIdentity.user})"
test "$(stat -c %a ${identity.home})" = 700
test "$(stat -c %a ${otherIdentity.home})" = 700
for attempt in $(seq 1 40); do test -s ${identity.home}/window.ns && break; sleep 0.25; done
cat ${identity.home}/window.ns
readlink /proc/self/ns/net
auth=$(find /tmp/sakura-single-app-${other.id.slice(0, 12)}.* -name Xauthority -print -quit)
test -n "$auth"
su ${identity.user} -s /bin/sh -c "test ! -r '$auth' && test ! -r '${otherIdentity.home}/.sakura-vnc-password'"
own_auth=$(find /tmp/sakura-single-app-${session.id.slice(0, 12)}.* -name Xauthority -print -quit)
su ${identity.user} -s /bin/sh -c "! DISPLAY=:${other.display} XAUTHORITY='$own_auth' xdpyinfo >/dev/null 2>&1"
test -n "$(find /proc -maxdepth 1 -user ${identity.user} 2>/dev/null | head -n 1)"`, 15000);
  assert.equal(boundary.code, 0, boundary.stderr);
  const [appNamespace, hostNamespace] = boundary.stdout.trim().split('\n');
  if (privateNetwork) {
    assert.notEqual(appNamespace, hostNamespace);
    const ns = await machines.exec(vm.id, network('readlink /proc/self/ns/net'), 5000);
    assert.equal(appNamespace, ns.stdout.trim());
    const unreachable = await machines.exec(vm.id,
      `! nc -z 127.0.0.1 ${session.port} >/dev/null 2>&1`, 5000);
    assert.equal(unreachable.code, 0, 'private VNC must not listen in the shared namespace');
  } else assert.equal(appNamespace, hostNamespace);
  const argumentsResult = await machines.exec(vm.id,
    'for process in /proc/[0-9]*; do cat "$process/cmdline" 2>/dev/null || true; done', 5000);
  assert.ok(!argumentsResult.stdout.includes(session.password), 'VNC password leaked in command lines');
  await assert.rejects(workspaces.save(vm.id, { networkIsolation: privateNetwork ? 'host' : 'private' }),
    /单应用窗口/);
  await assert.rejects(workspaces.save(vm.id, { ...project, directory: '/other-project' }),
    /单应用窗口/);
  assert.notEqual(other.port, session.port);
  assert.equal(await desktops.apps.port(vm.id, session.id), session.port);
  const handshake = await machines.exec(vm.id,
    network(`timeout 5 sh -c 'nc 127.0.0.1 ${session.port} | head -c 12'`), 10000);
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
  bridge = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => bridge!.once('listening', resolve));
  bridge.on('connection', (socket, request) => {
    const target = new URL(request.url || '/', 'http://localhost').searchParams.get('app');
    const app = target === session.id ? session : other;
    void desktops.attach(vm.id, socket, false, app.port, app.id).catch(() => socket.terminate());
  });
  const address = bridge.address();
  if (!address || typeof address === 'string') throw new Error('missing bridge port');
  browser = new WebSocket(`ws://127.0.0.1:${address.port}`);
  await Promise.race([
    new Promise<void>((resolve, reject) => {
      browser!.once('message', () => resolve());
      browser!.once('error', reject);
    }),
    delay(5000).then(() => { throw new Error('application RFB bridge did not connect'); }),
  ]);
  // Authenticate a real RFB client using the same DES implementation as noVNC.
  // A loopback client receives no SecurityType None bypass.
  const { DESECBCipher } = await import(new URL(
    '../node_modules/@novnc/novnc/core/crypto/des.js', import.meta.url).href);
  browser.terminate();
  const authenticate = async (password: string, accept: boolean) => {
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    let received = Buffer.alloc(0), ended = false;
    client.on('message', (data) => { received = Buffer.concat([received, Buffer.from(data as Buffer)]); });
    client.on('close', () => { ended = true; });
    client.on('error', () => { ended = true; });
    const read = async (length: number) => {
      const deadline = Date.now() + 10000;
      while (received.length < length) {
        if (ended || Date.now() > deadline) throw new Error('RFB authentication stream ended');
        await delay(10);
      }
      const value = received.subarray(0, length);
      received = received.subarray(length);
      return value;
    };
    try {
      assert.equal((await read(12)).toString(), 'RFB 003.008\n');
      client.send('RFB 003.008\n');
      const count = (await read(1))[0];
      assert.deepEqual([...await read(count)], [2], 'only VNC password authentication is permitted');
      client.send(Buffer.from([2]));
      const challenge = await read(16);
      const cipher = DESECBCipher.importKey(Buffer.from(password), {}, false, ['encrypt']);
      client.send(cipher.encrypt({}, challenge));
      const result = (await read(4)).readUInt32BE();
      assert.equal(result === 0, accept);
      if (accept) {
        client.send(Buffer.from([1]));
        const init = await read(24);
        assert.equal(init.readUInt16BE(), 1024);
        await read(init.readUInt32BE(20));
        return client;
      }
    } catch (error) { client.terminate(); throw error; }
    client.terminate();
  };
  await authenticate(session.password, false);
  browser = await authenticate(other.password, true);
  if (process.env.SAKURA_SINGLE_APP_BROWSER === '1') {
    const { createServer } = await import('vite');
    const { chromium } = await import('@playwright/test');
    const vite = await createServer({ optimizeDeps: { entries: ['single-app.html'] },
      server: { host: '127.0.0.1', port: 0 }, plugins: [{
      name: 'single-app-smoke-opener',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== '/single-app-smoke') return next();
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><title>Single app smoke</title>');
        });
      },
    }] });
    preview = vite;
    vite.httpServer!.on('upgrade', (request, socket, head) => {
      if (!request.url?.startsWith(`/ws/${vm.id}/desktop?`)) return;
      bridge!.handleUpgrade(request, socket, head, (ws) => bridge!.emit('connection', ws, request));
    });
    await vite.listen();
    const http = vite.httpServer!.address();
    assert.ok(http && typeof http !== 'string');
    const chromiumBrowser = await chromium.launch({ headless: true });
    webBrowser = chromiumBrowser;
    const page = await chromiumBrowser.newPage();
    await page.addInitScript('globalThis.__name = (value) => value');
    await page.goto(`http://127.0.0.1:${http.port}/single-app-smoke`);
    const popupEvent = page.waitForEvent('popup');
    await page.evaluate(({ vmId, session }) => {
      const nonce = crypto.randomUUID();
      const popup = window.open(`/single-app.html?nonce=${nonce}`, '_blank')!;
      const receive = (event: MessageEvent) => {
        if (event.source !== popup || event.origin !== location.origin || event.data?.nonce !== nonce)
          return;
        window.removeEventListener('message', receive);
        popup.postMessage({ type: 'sakura-single-app-init', nonce, vmId, session,
          token: 'single-app-smoke' }, location.origin);
      };
      window.addEventListener('message', receive);
    }, { vmId: vm.id, session });
    const popup = await popupEvent;
    await popup.waitForFunction(() => document.getElementById('status')?.textContent?.includes('已连接'),
      undefined, { timeout: 20000 });
    assert.equal(await popup.locator('#send').isDisabled(), true);
    assert.equal(await popup.locator('#copy').isDisabled(), true);
    assert.equal(await popup.locator('#screen canvas').count(), 1);
    await chromiumBrowser.close();
    webBrowser = undefined;
    await vite.close();
    preview = undefined;
    console.log('Real Chromium single-app noVNC password authentication and clipboard controls passed');
  }
  const disconnected = new Promise<void>((resolve) => browser!.once('close', () => resolve()));
  await desktops.apps.saveClipboardPolicy(vm.id, 'xterm', { copy: false, paste: false });
  await Promise.race([disconnected,
    delay(5000).then(() => { throw new Error('old application bridge stayed connected'); })]);
  await assert.rejects(desktops.apps.port(vm.id, other.id), /规则已收紧/);
  assert.equal((await desktops.apps.list(vm.id)).find((item) => item.id === other.id)?.status,
    'relaunch-required');
  assert.equal(await desktops.apps.port(vm.id, session.id), session.port,
    'an already restricted window remains available');
  assert.deepEqual((await desktops.apps.clipboardPolicies(vm.id)).xterm,
    { copy: false, paste: false });
  const governed = await desktops.apps.start(vm.id, { program: 'xterm',
    args: ['-hold', '-e', 'sh', '-c', 'sleep 600'],
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
  assert.equal(await desktops.apps.port(vm.id, governed.id), governed.port);
  const liveSessions = await desktops.apps.list(vm.id);
  assert.equal(liveSessions.filter((item) => item.status === 'running').length, 2);
  assert.equal(liveSessions.filter((item) => item.status === 'relaunch-required').length, 1);
  await desktops.apps.stop(vm.id, session.id);
  await delay(500);
  const stopped = await machines.exec(vm.id,
    network(`! nc -z 127.0.0.1 ${session.port} >/dev/null 2>&1`), 5000);
  assert.equal(stopped.code, 0, stopped.stderr);
  const cleanup = await machines.exec(vm.id, `set -eu
test -s ${identity.home}/window.ns
for process in /proc/[0-9]*; do
  test "$(stat -c %u "$process" 2>/dev/null)" != "$(id -u ${identity.user})"
done`, 10000);
  assert.equal(cleanup.code, 0, 'window data must survive and all descendant processes must stop');
  const cleanedPolicy = await machines.exec(vm.id, network(
    `! iptables -w -S SAP_${session.id.replaceAll('-', '').slice(0, 16)} >/dev/null 2>&1 && ` +
    `! ip6tables -w -S SAP_${session.id.replaceAll('-', '').slice(0, 16)} >/dev/null 2>&1`), 10000);
  assert.equal(cleanedPolicy.code, 0, 'stopped window firewall rules must be removed');
  await assert.rejects(desktops.apps.port(vm.id, other.id), /规则已收紧/);
  await desktops.apps.stop(vm.id, governed.id);
  await desktops.apps.stop(vm.id, other.id);
  await desktops.apps.removeClipboardPolicy(vm.id, 'xterm');
  assert.equal((await desktops.apps.clipboardPolicies(vm.id)).xterm, undefined);
  await workspaces.save(vm.id, { networkIsolation: privateNetwork ? 'host' : 'private' });
  const shuttingDown = [];
  for (let count = 0; count < 2; count++)
    shuttingDown.push(await desktops.apps.start(vm.id, { program: 'xterm',
      args: ['-hold', '-e', 'sh', '-c', 'sleep 600'] }));
  const shutdownProject = await workspaces.config(vm.id);
  await desktops.close();
  for (const app of shuttingDown) {
    const closed = await machines.exec(vm.id, projectNetworkCommand(shutdownProject,
      `! nc -z 127.0.0.1 ${app.port} >/dev/null 2>&1 && ` +
      `! iptables -w -S SAP_${app.id.replaceAll('-', '').slice(0, 16)} >/dev/null 2>&1 && ` +
      `! ip6tables -w -S SAP_${app.id.replaceAll('-', '').slice(0, 16)} >/dev/null 2>&1`), 10000);
    assert.equal(closed.code, 0, 'service shutdown skipped an application window');
  }
  await workspaces.save(vm.id, { networkIsolation: 'host' });
  console.log(`Real ${distro} ${privateNetwork ? 'private' : 'shared'} single-app network, independent Unix users, VNC authentication, clipboard revocation, configuration guard and process cleanup passed`);
} finally {
  await webBrowser?.close();
  await preview?.close();
  browser?.terminate();
  if (bridge) await new Promise<void>((resolve) => bridge!.close(() => resolve()));
  await desktops.close();
  await workspaces.close();
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-single-app-'));
  await rm(directory, { recursive: true, force: true });
}
