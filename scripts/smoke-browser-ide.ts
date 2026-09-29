import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-browser-ide-smoke-'));
const isolated = process.env.SAKURA_BROWSER_IDE_PRIVATE === '1';
const checkTerminal = isolated && process.env.SAKURA_BROWSER_IDE_TERMINAL === '1';
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { BrowserIde, browserIdePackage } = await import('../server/browser-ide.ts');
const { freePort } = await import('../server/qmp.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);
let ide = new BrowserIde(machines, workspaces);
await ide.init();
try {
  const vm = await machines.create({ name: 'browser-ide-smoke', distro: 'debian',
    memoryMiB: 3072, cpus: 2, diskGiB: 8, accelerator: 'auto' });
  await machines.start(vm.id);
  const deadline = Date.now() + 300_000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(300);
  }
  const cachedArchive = process.env.SAKURA_BROWSER_IDE_ARCHIVE;
  if (cachedArchive) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(resolve(cachedArchive))) hash.update(chunk);
    assert.equal(hash.digest('hex'), browserIdePackage.sha256, 'local IDE fixture has the wrong checksum');
    const directory = browserIdePackage.cachePath.slice(0, browserIdePackage.cachePath.lastIndexOf('/'));
    const created = await machines.exec(vm.id, `mkdir -p '${directory}'`, 10000);
    assert.equal(created.code, 0, created.stderr);
    const damaged = await machines.exec(vm.id,
      `printf 'invalid cached release' > '${browserIdePackage.cachePath}'`, 10000);
    assert.equal(damaged.code, 0, damaged.stderr);
    await assert.rejects(ide.run(vm.id, { mode: 'install' }, new AbortController().signal, () => {}),
      /checksum|FAILED/);
    assert.equal((await ide.view(vm.id)).installed, false, 'a damaged cache must not install executable content');
    await machines.sftp(vm.id, (sftp) => new Promise<void>((resolveCopy, reject) => {
      sftp.fastPut(resolve(cachedArchive), browserIdePackage.cachePath,
        (error) => error ? reject(error) : resolveCopy());
    }));
  }
  if (isolated) await workspaces.save(vm.id, { directory: '/workspace/private-ide',
    networkIsolation: 'private' });
  const hostPort = await freePort();
  const result = await ide.run(vm.id, { mode: 'start', guestPort: 8080,
    hostPort, ttlMinutes: checkTerminal ? 3 : 1 }, new AbortController().signal,
  (line) => process.stdout.write(line));
  assert.equal(result.session?.status, 'running');
  const link = await ide.link(vm.id);
  assert.equal(link.url, `http://127.0.0.1:${hostPort}/`);
  assert.match(link.password, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(await ide.view(vm.id)).includes(link.password), false);
  const anonymous = await fetch(link.url, { redirect: 'manual',
    signal: AbortSignal.timeout(10000) });
  await anonymous.body?.cancel();
  assert.match(anonymous.headers.get('location') || '', /\/login/);
  const invalid = await fetch(link.url + 'login', { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: 'incorrect-password' }),
    signal: AbortSignal.timeout(10000) });
  await invalid.body?.cancel();
  assert.equal(invalid.status, 200);
  const authenticated = await fetch(link.url + 'login', { method: 'POST',
    redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: link.password }),
    signal: AbortSignal.timeout(10000) });
  await authenticated.body?.cancel();
  assert.ok(authenticated.status >= 300 && authenticated.status < 400);
  const cookie = authenticated.headers.get('set-cookie');
  assert.ok(cookie);
  const opened = await fetch(link.url, { redirect: 'manual',
    headers: { cookie: cookie.split(';')[0] }, signal: AbortSignal.timeout(10000) });
  await opened.body?.cancel();
  assert.ok(!opened.headers.get('location')?.includes('/login'));
  const editor = await fetch(link.url, { headers: { cookie: cookie.split(';')[0] },
    signal: AbortSignal.timeout(10000) });
  const html = await editor.text();
  assert.equal(editor.status, 200);
  assert.match(editor.headers.get('content-type') || '', /text\/html/);
  assert.match(html, /<html/i);
  assert.ok(!editor.url.includes('/login'));
  if (isolated) {
    assert.equal(machines.get(vm.id).forwards.length, 0);
    const namespace = await machines.exec(vm.id,
      'test "$(ip -n sk-default -o link show | wc -l)" -eq 1 && ' +
      'test -z "$(ip -n sk-default -o -4 route show)" && ' +
      'test -z "$(ip -n sk-default -o -6 route show)" && ' +
      'test -n "$(ip netns pids sk-default)" && ' +
      'ip netns exec sk-default readlink /proc/self/ns/net', 10000);
    assert.equal(namespace.code, 0, namespace.stderr);
    const serverPids = await machines.exec(vm.id,
      'for p in $(ip netns pids sk-default); do ' +
      'tr "\\0" " " < /proc/$p/cmdline 2>/dev/null || true; echo; done', 10000);
    assert.equal(serverPids.code, 0, serverPids.stderr);
    assert.match(serverPids.stdout, /code-server/);
    if (checkTerminal) {
      const { chromium } = await import('@playwright/test');
      const browser = await chromium.launch({ headless: true });
      let page: import('@playwright/test').Page | undefined;
      try {
        const context = await browser.newContext();
        const authCookie = cookie.split(';')[0];
        const separator = authCookie.indexOf('=');
        await context.addCookies([{ name: authCookie.slice(0, separator),
          value: authCookie.slice(separator + 1), url: link.url }]);
        page = await context.newPage();
        await page.goto(link.url + '?folder=' + encodeURIComponent('/workspace/private-ide'));
        await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 45000 });
        const trust = page.getByRole('button', { name: /Yes, I trust the authors/ });
        if (await trust.isVisible()) await trust.click();
        const restricted = page.getByText('Restricted Mode', { exact: true });
        if (await restricted.isVisible()) {
          await restricted.click();
          await page.getByRole('button', { name: 'Trust', exact: true }).click({ timeout: 15000 });
          await trust.click({ timeout: 5000 }).catch(() => {});
          await restricted.waitFor({ state: 'hidden', timeout: 15000 });
        }
        await page.keyboard.press('Control+Shift+Backquote');
        await page.locator('.xterm-helper-textarea').first().focus({ timeout: 15000 });
        await page.keyboard.type('readlink /proc/self/ns/net > /workspace/private-ide/terminal.ns');
        await page.keyboard.press('Enter');
        let actual = '';
        const terminalDeadline = Date.now() + 20000;
        while (Date.now() < terminalDeadline) {
          const result = await machines.exec(vm.id,
            'cat /workspace/private-ide/terminal.ns 2>/dev/null', 5000);
          if (result.code === 0) { actual = result.stdout.trim(); break; }
          await delay(200);
        }
        assert.equal(actual, namespace.stdout.trim(), 'the IDE terminal did not inherit the private namespace');
        console.log('Browser IDE integrated terminal inherited the private project namespace.');
      } catch (error) {
        if (page) {
          await page.screenshot({ path: '.data/browser-ide-terminal.png', fullPage: true }).catch(() => {});
          console.log('Terminal UI diagnostics:', JSON.stringify({
            dialogs: await page.locator('.monaco-dialog-box').allTextContents(),
            palette: (await page.locator('.quick-input-widget').innerText().catch(() => '')).slice(0, 1000),
            terminals: await page.locator('.terminal').count(),
          }));
        }
        throw error;
      } finally { await browser.close(); }
    }
    await ide.close();
    ide = new BrowserIde(machines, workspaces);
    await ide.init();
    assert.deepEqual(await ide.link(vm.id), link);
    assert.equal((await ide.view(vm.id)).session?.status, 'running');
  }
  console.log(`Real Debian/QEMU browser IDE authenticated through ${isolated ? 'private SSH bridge' : 'QEMU forward'} ${hostPort}.`);
  await delay(Math.max(0, Date.parse(link.expiresAt) - Date.now()) + 2000);
  await assert.rejects(() => ide.link(vm.id), /过期|未就绪/);
  assert.equal(machines.get(vm.id).forwards.length, 0);
  const expiredProcess = await machines.exec(vm.id,
    `${isolated ? 'ip netns exec sk-default ' : ''}curl -fsS --max-time 2 http://127.0.0.1:8080/healthz >/dev/null`, 5000);
  assert.notEqual(expiredProcess.code, 0, 'code-server still accepts guest connections after expiry');
  if (isolated) await assert.rejects(fetch(link.url, { signal: AbortSignal.timeout(5000) }));
  console.log(`Browser IDE session expired and its ${isolated ? 'SSH entrance' : 'forward'} was removed.`);
} finally {
  await ide.close();
  await workspaces.close();
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
