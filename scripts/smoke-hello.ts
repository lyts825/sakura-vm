import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const data = await mkdtemp(join(tmpdir(), 'sakura-hello-'));
assert.equal(dirname(data), resolve(tmpdir()));
assert.match(basename(data), /^sakura-hello-/);
const listener = createServer();
await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
const port = (listener.address() as { port: number }).port;
await new Promise<void>((done) => listener.close(() => done()));
const origin = `http://127.0.0.1:${port}`;
const helloOrigin = `http://localhost:${port}`;
const password = 'a long administrator password';
const unlockPassword = 'a separate control lock password';
let server: ReturnType<typeof spawn> | undefined;
let output = '';
const request = async (path: string, method = 'GET', token?: string, input?: unknown,
  base = origin) => {
  const response = await fetch(base + path, { method,
    headers: { ...(token ? { 'x-sakura-token': token } : {}),
      ...(input !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: input === undefined ? undefined : JSON.stringify(input),
    signal: AbortSignal.timeout(20_000) });
  return { status: response.status, body: await response.json() as any };
};
try {
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
    try { if ((await request('/api/access/status')).status === 200) break; }
    catch {}
    await delay(200);
  }
  if (Date.now() >= deadline) throw new Error('Hello 测试服务未启动：' + output);
  const legacy = (await request('/api/bootstrap')).body.token;
  assert.equal((await request('/api/access/enable', 'POST', legacy, { password })).status, 200);
  const owner = await request('/api/access/login', 'POST', undefined,
    { username: 'owner', password });
  assert.equal(owner.status, 200);
  const ownerToken = owner.body.token as string;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true,
    } });
    await page.goto(helloOrigin);
    await page.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    await page.getByLabel('密码').fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    const manager = page.getByRole('region', { name: '通行密钥管理' });
    await manager.getByLabel('通行密钥名称').fill('本机平台测试密钥');
    await manager.getByLabel('当前账户密码').fill(password);
    await manager.getByLabel(/仅使用本机平台认证器/).check();
    const registration = page.waitForResponse((response) =>
      response.url().endsWith('/api/access/passkeys/register/verify'));
    await manager.getByRole('button', { name: '登记通行密钥' }).click();
    assert.equal((await registration).status(), 201);
    const settings = await request('/api/session/settings', 'PATCH', ownerToken,
      { enabled: true, idleMinutes: 15, password: '', newPassword: unlockPassword });
    assert.equal(settings.status, 200, JSON.stringify(settings.body));
    assert.equal((await request('/api/session/lock', 'POST', ownerToken, {})).status, 200);
    await page.getByRole('heading', { name: 'Sakura 已锁定' }).waitFor();
    assert.equal((await request('/api/session/unlock/passkey/options', 'POST',
      undefined, {})).status, 400);
    assert.equal((await request('/api/access/login', 'POST', undefined,
      { username: 'owner', password })).status, 423);
    const verified = page.waitForResponse((response) =>
      response.url().endsWith('/api/session/unlock/passkey/verify'));
    await page.getByRole('button', { name: '使用 Windows Hello / 本机通行密钥解锁' }).click();
    const verification = await verified;
    assert.equal(verification.status(), 200, await verification.text());
    const login = await verification.json();
    assert.equal(login.principal.role, 'owner');
    assert.equal(login.session.locked, false);
    await page.getByRole('button', { name: 'owner · 退出' }).waitFor();
    assert.equal((await request('/api/vms', 'GET', login.token)).status, 200);
    assert.equal((await request('/api/session/lock', 'POST', login.token, {})).status, 200);
    await page.getByRole('heading', { name: 'Sakura 已锁定' }).waitFor();
    const replay = await request('/api/session/unlock/passkey/verify', 'POST', undefined,
      verification.request().postDataJSON(), helloOrigin);
    assert.equal(replay.status, 409);
    assert.equal((await request('/api/session/unlock', 'POST', undefined,
      { password: unlockPassword })).status, 200);
    await page.close();
  } finally { await browser.close(); }
  console.log('Platform passkey registration, locked-screen unlock, replay rejection and password fallback passed.');
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise<void>((done) => server!.once('exit', () => done()));
    server.kill('SIGTERM');
    await Promise.race([exited, delay(10_000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
    await exited;
  }
  await rm(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
