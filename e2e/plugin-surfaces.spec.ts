import { expect, test, type Page } from '@playwright/test';
import { PLUGINS, PLUGIN_PACKS, emptySelection } from '../shared/plugins.ts';

const vm = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'example',
  memoryMiB: 512,
  cpus: 2,
  diskGiB: 8,
  diskBytes: 8 * 1024 ** 3,
  accelerator: 'auto',
  distro: 'alpine',
  template: 'none',
  forwards: [],
  createdAt: new Date().toISOString(),
  snapshots: [],
  status: 'stopped',
  poweredOn: false,
};

async function app(page: Page, active: string[] = [], withVm = false) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === '/api/bootstrap'
        ? { token: 'test-token' }
        : path === '/api/vms'
          ? withVm
            ? [vm]
            : []
          : path === '/api/system'
            ? {
                plugins: active,
                version: 'test',
                engine: 'test',
                posixloom: 'test',
                nativeHost: true,
                hostname: 'localhost',
                platform: 'test',
                hostCpus: 4,
                hostMemoryMiB: 4096,
                freeMemoryMiB: 2048,
                controllerMemoryMiB: 256,
                imageReady: true,
                imageBytes: 1,
              }
            : path === '/api/plugins'
              ? {
                  selection: emptySelection(),
                  active,
                  planned: active,
                  reasons: {},
                  migrations: [],
                  restartRequired: false,
                  errors: {},
                  lifecycle: {},
                  plugins: PLUGINS,
                  packs: PLUGIN_PACKS,
                }
              : path.endsWith('/projects')
                ? { active: 'default', projects: [{ id: 'default', name: '默认项目' }] }
                : path.endsWith('/commands')
                  ? { projectId: 'default', presets: [], job: null }
                  : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('/');
}

test('the empty install shows the core and the current plugin catalog', async ({ page }) => {
  await app(page);
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('button')).toHaveCount(3);
  await page.getByRole('button', { name: '插件中心' }).click();
  await expect(page.locator('.plugin-summary')).toContainText(/0\s*个插件运行中/);
  await expect(page.locator('.plugin-card')).toHaveCount(PLUGINS.length);
  await page
    .getByRole('group', { name: '插件浏览方式' })
    .getByRole('button', { name: /整合包/ })
    .click();
  await expect(page.locator('.plugin-card')).toHaveCount(PLUGIN_PACKS.length);
});

test('metrics and commands load their own client entries when selected', async ({ page }) => {
  await app(page, ['projects', 'metrics', 'commands'], true);
  await expect(page.getByRole('tab', { name: '配置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '更多插件功能' }).click();
  await page.getByRole('menuitem', { name: '资源', exact: true }).click();
  await expect(page.getByRole('heading', { name: '实时资源' })).toBeVisible();
  await page.getByRole('tab', { name: '开发', exact: true }).click();
  await page.getByRole('button', { name: '收藏命令' }).click();
  await expect(page.getByRole('heading', { name: '收藏新命令' })).toBeVisible();
});

test('capability center edits operation parameters, disables planned runs and explicitly unlocks', async ({
  page,
}) => {
  await app(page, ['projects', 'extensions', 'platform'], true);
  let submitted: any,
    locked = false;
  await page.route('**/api/vms', (route) =>
    route.fulfill({ json: [{ ...vm, status: 'running', poweredOn: true }] }),
  );
  await page.route('**/api/vms/*/lockdown*', (route) => {
    if (route.request().method() === 'POST') locked = route.request().postDataJSON().locked;
    return route.fulfill({ json: { locked } });
  });
  await page.route('**/api/vms/*/extended-features*', (route) => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ json: { status: 'running' } });
    }
    return route.fulfill({
      json: {
        projectId: 'default',
        settings: {},
        jobs: [],
        executions: [],
        operations: [
          {
            id: 'hash-manifest',
            feature: 'hash-manifest',
            name: '文件证据清单',
            example: { path: '.' },
            note: 'SHA-256',
            writes: false,
          },
        ],
        features: [
          { id: 'hash-manifest', name: '文件哈希清单', summary: '计算清单', state: 'available' },
          { id: 'disk-encryption', name: '虚拟磁盘加密', summary: '尚未实现', state: 'planned' },
        ],
      },
    });
  });
  await page.route('**/api/vms/*/next-features*', (route) =>
    route.fulfill({
      json: {
        projectId: 'default',
        settings: {},
        jobs: [],
        records: {},
        executions: [],
        features: [
          {
            id: 'desktop-recording',
            name: '桌面录制',
            category: '桌面',
            summary: '尚未实现',
            state: 'planned',
          },
        ],
      },
    }),
  );
  await page.reload();
  await page.getByRole('button', { name: '能力中心', exact: true }).click();
  await expect(page.getByRole('heading', { name: '能力中心', exact: true })).toBeVisible();
  await page.getByLabel('扩展工程操作').selectOption('hash-manifest');
  await expect(page.getByLabel('工程操作参数')).toContainText('"path": "."');
  await page.getByLabel('工程操作参数').fill('{"path":"src","output":"manifest.json"}');
  await page.getByRole('button', { name: '提交操作', exact: true }).click();
  await expect
    .poll(() => submitted)
    .toEqual({
      action: 'operation',
      operation: 'hash-manifest',
      parameters: { path: 'src', output: 'manifest.json' },
    });
  await expect(
    page
      .locator('.catalog-item')
      .filter({ hasText: '虚拟磁盘加密' })
      .getByRole('button', { name: '运行', exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .locator('.catalog-item')
      .filter({ hasText: '桌面录制' })
      .getByRole('button', { name: '运行', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '停止并锁定实例' }).click();
  await expect(page.getByRole('button', { name: '解除应急锁定' })).toBeEnabled();
  expect(locked).toBe(true);
  await page.getByRole('button', { name: '解除应急锁定' }).click();
  await expect(page.getByRole('button', { name: '停止并锁定实例' })).toBeEnabled();
  expect(locked).toBe(false);
});

test('sandbox workbench creates isolated environments, executes, cancels and preserves logs after destruction', async ({
  page,
}) => {
  await app(page, ['sandbox']);
  let sandboxes: any[] = [],
    runs: any[] = [];
  await page.route('**/api/sandboxes', async (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      expect(input.network).toBe('isolated');
      expect(input.onExpire).toBe('delete');
      expect(input.lifetimeMinutes).toBe(60);
      const created = {
        ...vm,
        ...input,
        name: input.name,
        expired: false,
        sandbox: {
          network: input.network,
          onExpire: input.onExpire,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      };
      sandboxes.push(created);
      await route.fulfill({ status: 201, json: created });
    } else await route.fulfill({ json: { sandboxes, runs } });
  });
  await page.route('**/api/vms/*/sandbox**', async (route) => {
    const request = route.request();
    if (request.url().endsWith('/run')) {
      expect(request.postDataJSON().command).toBe('printf sandbox-output');
      runs = [
        {
          id: 'test-job',
          vmId: vm.id,
          status: 'running',
          title: 'sandbox-demo · 沙箱命令',
          log: 'sandbox-output',
          startedAt: new Date().toISOString(),
        },
      ];
      sandboxes[0].status = 'running';
      sandboxes[0].poweredOn = true;
      await route.fulfill({ status: 202, json: runs[0] });
    } else {
      if (request.method() === 'DELETE') sandboxes = [];
      else {
        expect(request.postDataJSON().action).toBe('stop');
        sandboxes[0].status = 'stopped';
        sandboxes[0].poweredOn = false;
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
    if (route.request().method() === 'POST')
      await route.fulfill({ status: 503, json: { error: '镜像尚未准备好' } });
    else await route.fulfill({ json: { sandboxes: [], runs: [] } });
  });
  await page.getByRole('button', { name: '沙箱工作台', exact: true }).click();
  await page.getByLabel('沙箱名称', { exact: true }).fill('sandbox-demo');
  await page.getByRole('button', { name: '创建沙箱', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('镜像尚未准备好');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('navigation', { name: '主导航' }).locator('button').first()).toHaveCSS(
    'white-space',
    'nowrap',
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/sandbox-mobile.png', fullPage: true });
});

test('retained execution details fit mobile screens with long commands and artifact names', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await app(page, ['sandbox']);
  const command = `printf ${'long-output-'.repeat(24)} > result.txt`;
  const name = 'execution-report-'.repeat(6) + '.txt';
  await page.route('**/api/sandboxes', (route) =>
    route.fulfill({
      json: {
        sandboxes: [],
        runs: [
          {
            id: 'retained-run',
            vmId: vm.id,
            status: 'done',
            title: '沙箱命令',
            log: 'done',
            startedAt: new Date().toISOString(),
            execution: {
              command,
              cwd: '/workspace/' + 'long-path/'.repeat(8),
              timeoutSeconds: 300,
              requestedArtifacts: [name],
              outcome: 'success',
              exitCode: 0,
              timings: { bootMs: 3000, commandMs: 120, artifactsMs: 20, shutdownMs: 100, totalMs: 3240 },
              artifacts: [{ id: 'artifact', name, path: name, bytes: 10, sha256: 'a'.repeat(64) }],
            },
          },
        ],
      },
    }),
  );
  await page.getByRole('button', { name: '沙箱工作台', exact: true }).click();
  await expect(page.getByRole('heading', { name: '还没有沙箱' })).toBeVisible();
  await expect(page.getByLabel('执行命令', { exact: true })).toHaveText(command);
  await expect(page.getByRole('button', { name: '导出执行记录' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: new RegExp(`下载 ${name.replaceAll('.', '\\.')}`) }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'artifacts/sandbox-record-mobile.png', fullPage: true });
});
