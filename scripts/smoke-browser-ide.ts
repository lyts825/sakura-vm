import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-browser-ide-smoke-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { BrowserIde } = await import('../server/browser-ide.ts');
const { freePort } = await import('../server/qmp.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);
const ide = new BrowserIde(machines, workspaces);
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
  const hostPort = await freePort();
  const result = await ide.run(vm.id, { mode: 'start', guestPort: 8080,
    hostPort, ttlMinutes: 1 }, new AbortController().signal,
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
  console.log(`Real Debian/QEMU browser IDE authenticated through port ${hostPort}.`);
  await delay(Math.max(0, Date.parse(link.expiresAt) - Date.now()) + 2000);
  await assert.rejects(() => ide.link(vm.id), /过期|未就绪/);
  assert.equal(machines.get(vm.id).forwards.length, 0);
  const expiredProcess = await machines.exec(vm.id,
    'curl -fsS --max-time 2 http://127.0.0.1:8080/healthz >/dev/null', 5000);
  assert.notEqual(expiredProcess.code, 0, 'code-server still accepts guest connections after expiry');
  console.log('Browser IDE session expired and its forward was removed.');
} finally {
  ide.close();
  await workspaces.close();
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
