import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const data = await mkdtemp(join(tmpdir(), 'sakura-browser-extension-'));
const profile = await mkdtemp(join(tmpdir(), 'sakura-extension-profile-'));
assert.equal(dirname(data), resolve(tmpdir()));
assert.equal(dirname(profile), resolve(tmpdir()));
assert.match(basename(data), /^sakura-browser-extension-/);
assert.match(basename(profile), /^sakura-extension-profile-/);
const listener = createServer();
await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
const port = (listener.address() as { port: number }).port;
await new Promise<void>((done) => listener.close(() => done()));
const origin = `http://127.0.0.1:${port}`;
const password = 'a long administrator password';
let server: ReturnType<typeof spawn> | undefined;
let output = '';
const start = async () => {
  server = spawn(process.execPath, ['.sakura-server/index.js'], {
    cwd: resolve('.'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SAKURA_DATA_DIR: data, SAKURA_PORT: String(port),
      SAKURA_IMAGE_PATH: resolve('.data/images/alpine-3.23.qcow2') },
  });
  server.stdout?.on('data', (chunk) => { output += chunk; });
  server.stderr?.on('data', (chunk) => { output += chunk; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      if ((await fetch(origin + '/api/access/status',
        { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error('扩展测试服务未启动：' + output);
};
const stop = async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise<void>((done) => server!.once('exit', () => done()));
  server.kill('SIGTERM');
  await Promise.race([exited, delay(10_000)]);
  if (server.exitCode === null) server.kill('SIGKILL');
  await exited;
  server = undefined;
};
const request = async (path: string, method = 'GET', token?: string, body?: unknown,
  extraHeaders: Record<string, string> = {}) => {
  const response = await fetch(origin + path, {
    method, headers: { ...extraHeaders, ...(token ? { 'x-sakura-token': token } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status,
    body: response.status === 204 ? null : await response.json() as any,
    headers: response.headers };
};

try {
  await start();
  const legacy = (await request('/api/bootstrap')).body.token as string;
  const vm = await request('/api/vms', 'POST', legacy,
    { name: 'browser-fixture', memoryMiB: 512, cpus: 2, diskGiB: 4 });
  assert.equal(vm.status, 201, JSON.stringify(vm.body));
  assert.equal((await request('/api/access/enable', 'POST', legacy, { password })).status, 200);
  const owner = await request('/api/access/login', 'POST', undefined,
    { username: 'owner', password });
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
  const ownerToken = owner.body.token as string;

  const extensionRoot = resolve('browser-extension');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ||
      await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const extensionId = new URL(worker.url()).hostname;
    assert.match(extensionId, /^[a-p]{32}$/);
    const extensionOrigin = `chrome-extension://${extensionId}`;
    const ownerPage = await context.newPage();
    await ownerPage.goto(origin);
    await ownerPage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    await ownerPage.getByLabel('密码').fill(password);
    await ownerPage.getByRole('button', { name: '登录', exact: true }).click();
    await ownerPage.getByRole('button', { name: '系统设置', exact: true }).click();
    const manager = ownerPage.getByRole('region', { name: '浏览器扩展管理' });
    await manager.getByRole('button', { name: '生成扩展配对码' }).click();
    const pairingCode = await manager.locator('p[role="status"] code').innerText();
    assert.match(pairingCode, /^[A-Za-z0-9_-]{12}$/);
    const page = await context.newPage();
    await page.goto(extensionOrigin + '/popup.html');
    await page.getByText('尚未配对。').waitFor();
    await page.getByLabel('本机端口').fill(String(port));
    await page.getByLabel('配对码').fill(pairingCode);
    await page.getByRole('button', { name: '连接 Sakura' }).click();
    await page.getByText('browser-fixture').waitFor({ timeout: 10_000 }).catch(async () => {
      throw new Error('扩展弹窗配对失败：' + await page.locator('body').innerText() + '\n' + output);
    });
    await page.getByText('权限：实例摘要（只读）').waitFor();
    const dashboardOpened = context.waitForEvent('page');
    await page.getByRole('button', { name: '打开 Sakura' }).click();
    const dashboard = await dashboardOpened;
    await dashboard.waitForLoadState();
    assert.equal(dashboard.url(), origin + '/');
    await dashboard.close();
    const stored = await page.evaluate(() => (globalThis as any).chrome.storage.local.get('token'));
    assert.match(stored.token, /^[a-f0-9]{64}$/);
    const connections = await request('/api/browser-extensions', 'GET', ownerToken);
    assert.equal(connections.body.connections.length, 1);
    assert.equal(connections.body.connections[0].origin, extensionOrigin);
    assert.ok(!JSON.stringify(connections.body).includes(stored.token));
    await manager.getByRole('button', { name: '刷新连接' }).click();
    await manager.getByText(extensionOrigin).waitFor();
    const preflight = await request('/api/extension/connect', 'OPTIONS', undefined, undefined,
      { Origin: extensionOrigin, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-sakura-extension-origin' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), extensionOrigin);
    const inventory = await request('/api/extension/inventory', 'GET', undefined, undefined,
      { Origin: extensionOrigin, 'x-sakura-extension-origin': extensionOrigin,
        'x-sakura-extension-token': stored.token });
    assert.equal(inventory.status, 200, JSON.stringify(inventory.body));
    assert.equal(inventory.body.vms.length, 1);
    assert.equal(inventory.body.vms[0].id, vm.body.id);
    assert.ok(!JSON.stringify(inventory.body).includes('id_rsa'));
    assert.equal((await request('/api/extension/inventory', 'GET', undefined, undefined,
      { 'x-sakura-extension-origin': extensionOrigin,
        'x-sakura-extension-token': stored.token })).status, 200);
    assert.equal((await request('/api/extension/inventory', 'GET', undefined, undefined,
      { Origin: extensionOrigin, 'x-sakura-extension-token': stored.token })).status, 403);
    const webPage = await request('/api/extension/inventory', 'GET', undefined, undefined,
      { Origin: 'https://example.com', 'x-sakura-extension-origin': extensionOrigin,
        'x-sakura-extension-token': stored.token });
    assert.equal(webPage.status, 403);
    assert.equal(webPage.headers.get('access-control-allow-origin'), null);
    assert.equal((await request('/api/vms', 'GET', stored.token, undefined,
      { Origin: extensionOrigin })).status, 403);
    assert.equal((await request('/api/extension/inventory', 'GET', undefined, undefined,
      { Origin: `chrome-extension://${'b'.repeat(32)}`,
        'x-sakura-extension-origin': `chrome-extension://${'b'.repeat(32)}`,
        'x-sakura-extension-token': stored.token })).status, 401);
    assert.equal((await request('/api/extension/connect', 'POST', undefined,
      { code: pairingCode }, { Origin: extensionOrigin,
        'x-sakura-extension-origin': extensionOrigin })).status, 403);
    await manager.getByRole('button', { name: '撤销' }).click();
    await manager.getByText('扩展连接已撤销').waitFor();
    await page.getByRole('button', { name: '刷新' }).click();
    await page.getByText(/连接已失效，请重新配对/).waitFor();
    const nextCode = await request('/api/browser-extensions', 'POST', ownerToken, {});
    assert.equal(nextCode.status, 201);
    const second = await request('/api/extension/connect', 'POST', undefined,
      { code: nextCode.body.code }, { Origin: extensionOrigin,
        'x-sakura-extension-origin': extensionOrigin });
    assert.equal(second.status, 201);
    assert.equal((await request('/api/access/password', 'POST', ownerToken,
      { password, newPassword: 'a different administrator password' })).status, 200);
    assert.equal((await request('/api/extension/inventory', 'GET', undefined, undefined,
      { Origin: extensionOrigin, 'x-sakura-extension-origin': extensionOrigin,
        'x-sakura-extension-token': second.body.token })).status, 401);
    await page.close();
    await ownerPage.close();
  } finally { await context.close(); }
  console.log('Real Chromium extension pairing, read-only inventory and revocation passed.');
} finally {
  await stop();
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  await rm(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
