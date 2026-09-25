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

test('sandbox workbench creates isolated environments, executes, cancels and preserves logs after destruction', async ({ page }) => {
  await app(page, ['sandbox']);
  let sandboxes: any[] = [], runs: any[] = [];
  await page.route('**/api/sandboxes', async (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      expect(input.network).toBe('isolated');
      expect(input.onExpire).toBe('delete');
      expect(input.lifetimeMinutes).toBe(60);
      const created = { ...vm, ...input, name: input.name, expired: false,
        sandbox: { network: input.network, onExpire: input.onExpire, expiresAt: new Date(Date.now() + 3600000).toISOString() },
      };
      sandboxes.push(created);
      await route.fulfill({ status: 201, json: created });
    } else await route.fulfill({ json: { sandboxes, runs } });
  });
  await page.route('**/api/vms/*/sandbox**', async (route) => {
    const request = route.request();
    if (request.url().endsWith('/run')) {
      expect(request.postDataJSON().command).toBe('printf sandbox-output');
      runs = [{ id: 'test-job', vmId: vm.id, status: 'running', title: 'sandbox-demo · 沙箱命令',
        log: 'sandbox-output', startedAt: new Date().toISOString() }];
      sandboxes[0].status = 'running';
      sandboxes[0].poweredOn = true;
      await route.fulfill({ status: 202, json: runs[0] });
    } else {
      if (request.method() === 'DELETE') sandboxes = [];
      else {
        expect(request.postDataJSON().action).toBe('stop');
        sandboxes[0].status = 'stopped'; sandboxes[0].poweredOn = false;
        runs[0].status = 'cancelled';
      }
      await route.fulfill({ json: { ok: true } });
    }
  });
  await page.getByRole('button', { name: '沙箱工作台', exact: true }).click();
  await expect(page.getByRole('heading', { name: '还没有沙箱' })).toBeVisible();
  await page.getByLabel('沙箱名称', { exact: true }).fill('sandbox-demo');
  await page.getByRole('button', { name: '创建沙箱', exact: true }).click();
  await expect(page.getByRole('heading', { name: '在 sandbox-demo 中执行' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Linux 命令', exact: true }).fill('printf sandbox-output');
  await page.getByRole('button', { name: '执行命令', exact: true }).click();
  await expect(page.getByLabel('操作日志')).toContainText('sandbox-output');
  await expect(page.getByRole('button', { name: '执行命令', exact: true })).toBeDisabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/sandbox-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '取消执行', exact: true }).click();
  await expect(page.locator('.job-block')).toContainText('已取消');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '销毁 sandbox-demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: '还没有沙箱' })).toBeVisible();
  await expect(page.getByLabel('操作日志')).toContainText('sandbox-output');
});

test('sandbox page fits a phone and reports creation errors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await app(page, ['sandbox']);
  await page.route('**/api/sandboxes', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 503, json: { error: '镜像尚未准备好' } });
    else await route.fulfill({ json: { sandboxes: [], runs: [] } });
  });
  await page.getByRole('button', { name: '沙箱工作台', exact: true }).click();
  await page.getByLabel('沙箱名称', { exact: true }).fill('sandbox-demo');
  await page.getByRole('button', { name: '创建沙箱', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('镜像尚未准备好');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('navigation', { name: '主导航' }).locator('button').first()).toHaveCSS('white-space', 'nowrap');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/sandbox-mobile.png', fullPage: true });
});
