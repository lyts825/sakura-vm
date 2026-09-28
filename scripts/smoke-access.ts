import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { WebSocket } from 'ws';

const data = await mkdtemp(join(tmpdir(), 'sakura-access-vm-'));
assert.ok(resolve(data).startsWith(resolve(tmpdir()) + sep));
const listener = createServer();
await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
const port = (listener.address() as { port: number }).port;
await new Promise<void>((done) => listener.close(() => done()));
const origin = `http://127.0.0.1:${port}`;
const passkeyOrigin = `http://localhost:${port}`;
const password = 'a long administrator password';
let server: ReturnType<typeof spawn> | undefined;
let output = '';
const start = async () => {
  server = spawn(process.execPath, ['.sakura-server/index.js'], {
    cwd: resolve('.'),
    env: { ...process.env, SAKURA_DATA_DIR: data, SAKURA_PORT: String(port),
      SAKURA_IMAGE_PATH: resolve('.data/images/alpine-3.23.qcow2') },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  output = '';
  server.stdout?.on('data', (chunk) => { output += chunk; });
  server.stderr?.on('data', (chunk) => { output += chunk; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      const response = await fetch(origin + '/api/access/status', { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error('账户测试服务未启动：' + output);
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
  base = origin) => {
  const response = await fetch(base + path, {
    method, headers: { ...(token ? { 'x-sakura-token': token } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, body: await response.json() as any };
};
const wsStatus = async (token: string, path = '/ws/events') => {
  const socket = new WebSocket(origin.replace('http:', 'ws:') + path + '?token=' + token,
    { handshakeTimeout: 3000 });
  socket.on('error', () => {});
  return new Promise<number>((done, fail) => {
    socket.once('unexpected-response', (_request, response) => {
      response.resume(); socket.terminate(); done(response.statusCode || 0);
    });
    socket.once('open', () => { socket.close(); done(101); });
    socket.once('error', fail);
  });
};

try {
  await start();
  let legacy = (await request('/api/bootstrap')).body.token as string;
  assert.equal(legacy.length, 64);
  assert.equal((await request('/api/plugins', 'PATCH', legacy,
    { kind: 'plugin', id: 'desktop', enabled: true })).status, 200);
  await stop();
  await start();
  legacy = (await request('/api/bootstrap')).body.token as string;
  const created = await request('/api/vms', 'POST', legacy,
    { name: 'access-fixture', memoryMiB: 512, cpus: 2, diskGiB: 4 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const vmId = created.body.id as string;
  const another = await request('/api/vms', 'POST', legacy,
    { name: 'private-fixture', memoryMiB: 512, cpus: 2, diskGiB: 4 });
  assert.equal(another.status, 201, JSON.stringify(another.body));
  assert.equal((await request('/api/access/enable', 'POST', legacy, { password })).status, 200);
  assert.equal((await request('/api/bootstrap')).status, 401);
  assert.equal((await request('/api/vms', 'GET', legacy)).status, 401);
  const owner = await request('/api/access/login', 'POST', undefined,
    { username: 'owner', password });
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
  const ownerToken = owner.body.token as string;
  assert.equal((await request('/api/vms', 'GET', ownerToken)).status, 200);
  const viewer = await request('/api/access/users', 'POST', ownerToken, {
    username: 'reader', password: 'a long viewer password', vmIds: [vmId],
    expiresAt: Date.now() + 86_400_000,
  });
  assert.equal(viewer.status, 201, JSON.stringify(viewer.body));
  const loggedIn = await request('/api/access/login', 'POST', undefined,
    { username: 'reader', password: 'a long viewer password' });
  assert.equal(loggedIn.status, 200);
  let viewerToken = loggedIn.body.token as string;
  const viewerHandoff = await request('/api/access/handoff', 'POST', viewerToken,
    { password: 'a long viewer password' });
  assert.equal(viewerHandoff.status, 200, JSON.stringify(viewerHandoff.body));
  const viewerMoved = await request('/api/access/handoff/redeem', 'POST', undefined,
    { code: viewerHandoff.body.code });
  assert.equal(viewerMoved.status, 200);
  assert.equal(viewerMoved.body.principal.role, 'viewer');
  assert.deepEqual(viewerMoved.body.principal.vmIds, [vmId]);
  assert.equal(viewerMoved.body.principal.expiresAt, loggedIn.body.principal.expiresAt);
  assert.equal((await request('/api/access/view', 'GET', viewerToken)).status, 401);
  viewerToken = viewerMoved.body.token;
  const inventory = await request('/api/access/view', 'GET', viewerToken);
  assert.equal(inventory.status, 200);
  assert.equal(inventory.body.vms.length, 1);
  assert.equal(inventory.body.vms[0].id, vmId);
  assert.equal(inventory.body.desktopAvailable, true);
  assert.ok(!JSON.stringify(inventory.body).includes('id_rsa'));
  for (const path of ['/api/vms', '/api/audit', '/api/graphql-schema'])
    assert.equal((await request(path, 'GET', viewerToken)).status, 403, path);
  assert.equal((await request('/api/vms/' + vmId + '/stop', 'POST', viewerToken, {})).status, 403);
  assert.equal(await wsStatus(viewerToken), 403);
  assert.equal(await wsStatus(viewerToken, '/ws/' + vmId + '/desktop-view'), 101);
  assert.equal(await wsStatus(viewerToken, '/ws/' + vmId + '/desktop'), 403);
  assert.equal(await wsStatus(viewerToken, '/ws/' + another.body.id + '/desktop-view'), 403);
  assert.equal(await wsStatus(ownerToken), 101);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // The fixture VM is stopped; present it as running to exercise the view-only UI path.
    await page.route('**/api/access/view', async (route) => {
      const response = await route.fetch();
      const result = await response.json();
      return route.fulfill({ response, json: { ...result,
        vms: result.vms.map((vm: { status: string }) => ({ ...vm, status: 'running' })) } });
    });
    await page.goto(origin);
    await page.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    await page.getByLabel('账户名').fill('reader');
    await page.getByLabel('密码').fill('a long viewer password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('heading', { name: '已授权实例' }).waitFor();
    await page.getByText('access-fixture').waitFor();
    assert.equal(await page.getByText('终端', { exact: true }).count(), 0);
    const desktopSocket = page.waitForEvent('websocket', {
      predicate: (socket) => socket.url().includes('/ws/' + vmId + '/desktop-view?'),
    });
    await page.getByRole('button', { name: '只读查看桌面' }).click();
    await desktopSocket;
    await page.getByRole('heading', { name: '只读桌面视图' }).waitFor();
    await page.getByRole('button', { name: '关闭桌面视图' }).click();
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByRole('heading', { name: '登录 Sakura' }).waitFor();

    const passkeyPage = await browser.newPage();
    const cdp = await passkeyPage.context().newCDPSession(passkeyPage);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true,
    } });
    assert.equal((await request('/api/access/passkeys/login/options', 'POST', undefined, {})).status, 400);
    await passkeyPage.goto(passkeyOrigin);
    await passkeyPage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    assert.equal(await passkeyPage.getByLabel('账户名').inputValue(), 'owner');
    await passkeyPage.getByLabel('密码').fill(password);
    const ownerBrowserLogin = passkeyPage.waitForResponse((response) =>
      response.url().endsWith('/api/access/login'));
    await passkeyPage.getByRole('button', { name: '登录', exact: true }).click();
    const ownerBrowserResponse = await ownerBrowserLogin;
    assert.equal(ownerBrowserResponse.status(), 200, await ownerBrowserResponse.text());
    const ownerBrowserData = await ownerBrowserResponse.json();
    assert.equal(ownerBrowserData.principal.role, 'owner');
    assert.equal(ownerBrowserData.token.length, 64);
    await passkeyPage.getByRole('button', { name: '系统设置', exact: true }).waitFor({ timeout: 8000 })
      .catch(async () => { throw new Error('Owner browser login failed: ' +
        await passkeyPage.locator('body').innerText()); });
    await passkeyPage.getByRole('button', { name: '系统设置', exact: true }).click();
    const manager = passkeyPage.getByRole('region', { name: '通行密钥管理' });
    await manager.getByLabel('通行密钥名称').fill('local-key');
    await manager.getByLabel('当前账户密码').fill(password);
    const registrationVerify = passkeyPage.waitForResponse((response) =>
      response.url().endsWith('/api/access/passkeys/register/verify'));
    await manager.getByRole('button', { name: '登记通行密钥' }).click();
    await manager.getByText('通行密钥已登记').waitFor();
    const registered = await registrationVerify;
    assert.equal(registered.status(), 201);
    assert.equal((await request('/api/access/passkeys/register/verify', 'POST',
      ownerBrowserData.token, registered.request().postDataJSON(), passkeyOrigin)).status, 409);
    const savedKeys = (await request('/api/access/passkeys', 'GET', ownerToken)).body.passkeys;
    assert.equal(savedKeys.length, 1);
    assert.equal(savedKeys[0].name, 'local-key');
    assert.ok(!JSON.stringify(savedKeys).includes('publicKey'));
    await passkeyPage.getByRole('button', { name: 'owner · 退出' }).click();
    await passkeyPage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    const loginVerify = passkeyPage.waitForResponse((response) =>
      response.url().endsWith('/api/access/passkeys/login/verify'));
    await passkeyPage.getByRole('button', { name: '使用通行密钥登录' }).click();
    await passkeyPage.getByRole('button', { name: 'owner · 退出' }).waitFor();
    const verified = await loginVerify;
    assert.equal(verified.status(), 200);
    const passkeyLogin = await verified.json();
    assert.equal((await request('/api/vms', 'GET', passkeyLogin.token)).status, 200);
    assert.equal((await request('/api/access/passkeys/login/verify', 'POST', undefined,
      verified.request().postDataJSON(), passkeyOrigin)).status, 409);
    assert.equal((await request('/api/access/passkeys/' + savedKeys[0].id, 'DELETE', ownerToken,
      { password: 'incorrect' })).status, 403);
    assert.equal((await request('/api/access/passkeys/' + savedKeys[0].id, 'DELETE', ownerToken,
      { password })).status, 200);
    assert.equal((await request('/api/vms', 'GET', passkeyLogin.token)).status, 401);
    assert.equal((await request('/api/access/passkeys', 'GET', ownerToken)).body.passkeys.length, 0);
    await passkeyPage.close();

    assert.equal((await request('/api/access/handoff', 'POST', ownerToken,
      { password: 'incorrect' })).status, 403);
    const sourcePage = await browser.newPage();
    await sourcePage.goto(origin);
    await sourcePage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    await sourcePage.getByLabel('密码').fill(password);
    const sourceLoginResponse = sourcePage.waitForResponse((response) =>
      response.url().endsWith('/api/access/login'));
    await sourcePage.getByRole('button', { name: '登录', exact: true }).click();
    const sourceLogin = await (await sourceLoginResponse).json();
    await sourcePage.getByRole('button', { name: '系统设置', exact: true }).click();
    const handoffManager = sourcePage.getByRole('region', { name: '会话交接' });
    await handoffManager.getByLabel('当前账户密码').fill(password);
    await handoffManager.getByRole('button', { name: '生成交接码' }).click();
    const handoffCode = await handoffManager.getByRole('status').locator('code').innerText();
    assert.match(handoffCode, /^[A-Za-z0-9_-]{24}$/);
    const targetPage = await browser.newPage();
    await targetPage.goto(origin);
    await targetPage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    await targetPage.getByLabel('会话交接码').fill(handoffCode);
    const redeemResponse = targetPage.waitForResponse((response) =>
      response.url().endsWith('/api/access/handoff/redeem'));
    await targetPage.getByRole('button', { name: '接收会话' }).click();
    await targetPage.getByRole('button', { name: '系统设置', exact: true }).waitFor();
    const moved = await (await redeemResponse).json();
    assert.equal(moved.principal.role, 'owner');
    assert.equal((await request('/api/vms', 'GET', sourceLogin.token)).status, 401);
    assert.equal((await request('/api/vms', 'GET', moved.token)).status, 200);
    assert.equal((await request('/api/access/handoff/redeem', 'POST', undefined,
      { code: handoffCode })).status, 403);
    await sourcePage.close();
    await targetPage.close();
  } finally { await browser.close(); }

  assert.equal((await request('/api/access/users/' + viewer.body.id, 'DELETE', ownerToken)).status, 200);
  assert.equal((await request('/api/access/view', 'GET', viewerToken)).status, 401);
  assert.equal((await request('/api/access/login', 'POST', undefined,
    { username: 'reader', password: 'a long viewer password' })).status, 403);
  const audit = await request('/api/audit', 'GET', ownerToken);
  assert.equal(audit.status, 200);
  assert.ok(JSON.stringify(audit.body).includes(owner.body.principal.id));
  const lockPassword = 'a separate control lock password';
  assert.equal((await request('/api/session/settings', 'PATCH', ownerToken,
    { enabled: true, idleMinutes: 15, password: '', newPassword: lockPassword })).status, 200);
  assert.equal((await request('/api/session/lock', 'POST', ownerToken, {})).status, 200);
  assert.equal((await request('/api/vms', 'GET', ownerToken)).status, 423);
  assert.equal((await request('/api/access/login', 'POST', undefined,
    { username: 'owner', password })).status, 423);
  assert.equal((await request('/api/session/unlock', 'POST', undefined,
    { password: lockPassword })).status, 200);
  assert.equal((await request('/api/vms', 'GET', ownerToken)).status, 401);
  const afterLock = await request('/api/access/login', 'POST', undefined,
    { username: 'owner', password });
  assert.equal(afterLock.status, 200);
  const newPassword = 'a different administrator password';
  assert.equal((await request('/api/access/password', 'POST', afterLock.body.token,
    { password, newPassword })).status, 200);
  assert.equal((await request('/api/vms', 'GET', afterLock.body.token)).status, 401);
  assert.equal((await request('/api/access/login', 'POST', undefined,
    { username: 'owner', password })).status, 403);
  await stop();
  await start();
  assert.equal((await request('/api/session/unlock', 'POST', undefined,
    { password: lockPassword })).status, 200);
  assert.equal((await request('/api/bootstrap')).status, 401);
  assert.equal((await request('/api/vms', 'GET', ownerToken)).status, 401);
  const again = await request('/api/access/login', 'POST', undefined,
    { username: 'owner', password: newPassword });
  assert.equal(again.status, 200);
  assert.equal((await request('/api/vms', 'GET', again.body.token)).status, 200);
  console.log('Account mode HTTP, WebSocket, browser, revocation and restart validation passed');
} finally {
  await stop();
  await rm(data, { recursive: true, force: true });
}
