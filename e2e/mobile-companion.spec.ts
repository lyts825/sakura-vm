import { test, expect } from '@playwright/test';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostPeers } from '../server/host-peers.ts';
import { MobileCompanion } from '../server/mobile-companion.ts';
import type { AccessControl } from '../server/access-control.ts';

test.use({ ignoreHTTPSErrors: true });

async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

test('paired phone sees only authorized status and alerts over the HTTPS listener', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-mobile-browser-'));
  const port = await freePort();
  const file = join(directory, 'host.json');
  const source = async () => ({ platform: 'win32', arch: 'x64', cpus: 4,
    memoryTotal: 8 * 1024 ** 3, memoryFree: 4 * 1024 ** 3,
    load: [0, 0, 0], vmCount: 2, runningVms: 1 });
  const configured = new HostPeers(source, file, 'Sakura');
  await configured.init(false);
  await configured.configure({ operation: 'listener', listener: {
    enabled: true, host: '127.0.0.1', port } });
  await configured.close();
  const host = new HostPeers(source, file, 'Sakura');
  await host.init(true);
  const ownerId = '00000000-0000-4000-8000-000000000001';
  const vmId = '00000000-0000-4000-8000-000000000002';
  const access = { enabled: true, users: () => [{ id: ownerId, role: 'owner' }] } as
    unknown as AccessControl;
  const mobile = new MobileCompanion(access, async () => ({
    vms: [{ id: vmId, name: '手机可见实例', status: 'running' },
      { id: '00000000-0000-4000-8000-000000000003', name: '机密实例', status: 'stopped' }],
    alerts: [{ id: 'alert-1', vmId, kind: 'cpu', message: '不应发送到手机的告警详情',
      createdAt: new Date().toISOString(), acknowledged: false }],
  }), undefined, join(directory, 'mobile.json'));
  await mobile.init();
  host.setMobileHandler((request, response) => mobile.handle(request, response));
  try {
    const result = await mobile.action(ownerId, { operation: 'pair',
      policy: { enabled: true, vmIds: [vmId], kinds: ['cpu'] } });
    if (!('code' in result) || typeof result.code !== 'string') throw new Error('No code');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`https://127.0.0.1:${port}/mobile/`);
    await expect(page.getByRole('heading', { name: '连接这台 Sakura' })).toBeVisible();
    await page.getByLabel('设备名称').fill('测试手机');
    await page.getByLabel('配对码').fill(result.code);
    await page.getByRole('button', { name: '连接', exact: true }).click();
    await expect(page.locator('#vms').getByText('手机可见实例')).toBeVisible();
    await expect(page.locator('#alerts').getByText('cpu')).toBeVisible();
    await expect(page.getByText('机密实例')).toHaveCount(0);
    await expect(page.getByText('不应发送到手机的告警详情')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    const deviceId = mobile.view(ownerId).devices[0].id;
    await mobile.action(ownerId, { operation: 'revoke', id: deviceId });
    await page.getByRole('button', { name: '刷新' }).click();
    await expect(page.getByRole('heading', { name: '连接这台 Sakura' })).toBeVisible();
  } finally {
    await mobile.close();
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
