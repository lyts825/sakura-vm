import { test, expect, type Page } from '@playwright/test';
import { PLUGINS, PLUGIN_PACKS, emptySelection } from '../shared/plugins.ts';

const vm = {
  id: '11111111-1111-4111-8111-111111111111', name: 'example',
  memoryMiB: 512, cpus: 2, diskGiB: 8, diskBytes: 8 * 1024 ** 3,
  accelerator: 'auto', distro: 'alpine', template: 'none', forwards: [],
  createdAt: new Date().toISOString(), snapshots: [], status: 'stopped', poweredOn: false,
};

async function app(page: Page, active: string[] = [], withVm = false) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path === '/api/bootstrap' ? { token: 'test-token' }
      : path === '/api/vms' ? (withVm ? [vm] : [])
      : path === '/api/system' ? {
          plugins: active, version: 'test', engine: 'test', posixloom: 'test', nativeHost: true,
          hostname: 'localhost', platform: 'test', hostCpus: 4, hostMemoryMiB: 4096,
          freeMemoryMiB: 2048, controllerMemoryMiB: 256, imageReady: true, imageBytes: 1,
        }
      : path === '/api/plugins' ? {
          selection: emptySelection(), active, planned: active, reasons: {}, migrations: [],
          restartRequired: false, errors: {}, lifecycle: {}, plugins: PLUGINS, packs: PLUGIN_PACKS,
        }
      : path.endsWith('/projects') ? { active: 'default', projects: [{ id: 'default', name: '默认项目' }] }
      : path.endsWith('/commands') ? { projectId: 'default', presets: [], job: null }
      : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('/');
}

test('the empty install shows the core and the current plugin catalog', async ({ page }) => {
  await app(page);
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('button')).toHaveCount(3);
  await page.getByRole('button', { name: '插件中心' }).click();
  await expect(page.locator('.plugin-summary')).toContainText('0 个插件运行中');
  await expect(page.locator('.plugin-card')).toHaveCount(PLUGINS.length + PLUGIN_PACKS.length);
});

test('metrics and commands load their own client entries when selected', async ({ page }) => {
  await app(page, ['projects', 'metrics', 'commands'], true);
  await page.getByRole('tab', { name: '资源', exact: true }).click();
  await expect(page.getByRole('heading', { name: '实时资源' })).toBeVisible();
  await page.getByRole('tab', { name: '开发', exact: true }).click();
  await page.getByRole('button', { name: '收藏命令' }).click();
  await expect(page.getByRole('heading', { name: '收藏新命令' })).toBeVisible();
});
