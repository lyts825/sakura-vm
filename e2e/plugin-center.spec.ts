import { expect, test, type Page } from '@playwright/test';
import {
  PLUGINS,
  PLUGIN_PACKS,
  emptySelection,
  type PluginSelection,
  type PluginStatus,
} from '../shared/plugins.ts';
import { explainPlugins, resolvePlugins } from '../shared/plugin-selection.ts';

async function setup(
  page: Page,
  options: {
    selection?: PluginSelection;
    active?: string[];
    errors?: PluginStatus['errors'];
    lifecycle?: PluginStatus['lifecycle'];
    readError?: boolean;
    writeError?: boolean;
  } = {},
) {
  let selection = options.selection || emptySelection();
  const active = options.active || [];
  let writes = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/plugins') {
      if (options.readError && route.request().method() === 'GET') {
        options.readError = false;
        return route.fulfill({ status: 503, json: { error: '插件服务暂时不可用' } });
      }
      if (route.request().method() === 'PATCH') {
        writes++;
        if (options.writeError) return route.fulfill({ status: 500, json: { error: '保存失败，请重试' } });
        const { kind, id, enabled } = route.request().postDataJSON();
        const key = kind === 'pack' ? 'packs' : 'plugins';
        const next = {
          ...selection,
          [key]: enabled
            ? [...new Set([...selection[key], id])]
            : selection[key].filter((item) => item !== id),
        };
        if (!enabled && kind === 'plugin' && resolvePlugins(next).includes(id))
          return route.fulfill({ status: 409, json: { error: '此插件仍被依赖' } });
        selection = next;
      }
      const planned = resolvePlugins(selection);
      return route.fulfill({
        json: {
          selection,
          active,
          planned,
          reasons: explainPlugins(selection),
          migrations: [],
          restartRequired: active.length !== planned.length || planned.some((id) => !active.includes(id)),
          errors: options.errors || {},
          lifecycle: options.lifecycle || {},
          plugins: PLUGINS,
          packs: PLUGIN_PACKS,
        } satisfies PluginStatus,
      });
    }
    return route.fulfill({
      json:
        path === '/api/bootstrap'
          ? { token: 'test' }
          : path === '/api/vms'
            ? []
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
              : {},
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '插件中心', exact: true }).click();
  return { selection: () => selection, writes: () => writes };
}
const view = (page: Page, name: string) =>
  page.getByRole('group', { name: '插件浏览方式' }).getByRole('button', { name: new RegExp(name) });

test('plugin catalog searches, combines filters, and keeps the base configuration empty', async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByRole('article')).toHaveCount(PLUGINS.length);
  await page.getByRole('searchbox').fill('FILES');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article', { name: '文件工作台', exact: true })).toBeVisible();
  await page
    .getByRole('group', { name: '按用途查看' })
    .getByRole('button', { name: '项目开发', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '没有找到匹配的插件' })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(PLUGINS.length);
  await view(page, '我的配置').click();
  await expect(page.getByRole('heading', { name: '从基础版开始，也很好。' })).toBeVisible();
  await page.getByRole('button', { name: '浏览插件目录' }).click();
  await page.getByLabel('按插件状态筛选').selectOption('active');
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('pack selection, independent retention and removal preserve shared dependencies without activating navigation', async ({
  page,
}) => {
  const state = await setup(page);
  await view(page, '整合包').click();
  const essentials = page.getByRole('article', { name: '日常使用', exact: true });
  await expect(essentials).toContainText('选用后新增 5 个计划插件');
  await essentials.getByRole('button', { name: '选用整合包' }).click();
  await expect(page.locator('.plugin-restart')).toContainText('新增 5 个 · 停用 0 个');
  await expect(page.locator('.plugin-summary')).toContainText(/0\s*个插件运行中/);
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('button')).toHaveCount(3);
  await view(page, '我的配置').click();
  const files = page.getByRole('article', { name: '文件工作台', exact: true });
  await expect(files).toContainText('由 日常使用 引入');
  await expect(files.locator('.plugin-state')).toHaveText('待启用');
  await files.getByRole('button', { name: '保留为独立选择' }).click();
  await expect(files.getByRole('button', { name: '被其他选择引用' })).toBeDisabled();
  await expect(files).toContainText('先移除引用来源：日常使用');
  await expect(essentials).toContainText('移除后减少 3 个计划插件');
  await essentials.getByRole('button', { name: '移除整合包' }).click();
  await expect(files.getByRole('button', { name: '取消独立选择' })).toBeEnabled();
  await expect(page.getByRole('article')).toHaveCount(2);
  expect(state.selection()).toEqual({ ...emptySelection(), plugins: ['files'] });
  await files.getByRole('button', { name: '取消独立选择' }).click();
  await expect(page.getByRole('heading', { name: '从基础版开始，也很好。' })).toBeVisible();
  await expect(page.locator('.plugin-restart')).toHaveCount(0);
  expect(state.writes()).toBe(4);
});

test('runtime, pending removal and dependency failures remain distinct', async ({ page }) => {
  await setup(page, {
    selection: { ...emptySelection(), plugins: ['files', 'metrics'] },
    active: ['metrics', 'images'],
    errors: { transfers: '无法打开传输目录', files: '必需依赖 transfers 未就绪' },
    lifecycle: {
      transfers: { phase: 'failed', activationMs: 2 },
      files: { phase: 'skipped', activationMs: 0 },
      metrics: { phase: 'active', activationMs: 7 },
    },
  });
  await expect(
    page.getByRole('article', { name: '资源采样', exact: true }).locator('.plugin-state'),
  ).toHaveText('运行中');
  const images = page.getByRole('article', { name: '发行版镜像', exact: true });
  await expect(images.locator('.plugin-state')).toHaveText('待停用');
  await page.getByRole('button', { name: '查看异常' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(
    page.getByRole('article', { name: '文件工作台', exact: true }).locator('.plugin-state'),
  ).toHaveText('依赖未就绪');
  await expect(page.locator('.plugin-inline-error').filter({ hasText: '无法打开传输目录' })).toBeVisible();
  await page.getByLabel('按插件状态筛选').selectOption('pending');
  await expect(page.getByRole('article')).toHaveCount(3);
  await page.getByText('查看变更与重启方式', { exact: true }).click();
  await expect(page.locator('.plugin-restart')).toContainText('刷新浏览器不会重启服务');
});

test('failed reads can be retried and rejected changes preserve the current selection', async ({ page }) => {
  const state = await setup(page, { readError: true, writeError: true });
  await expect(page.getByRole('alert')).toContainText('插件服务暂时不可用');
  await expect(page.getByRole('heading', { name: '暂时无法读取插件' })).toBeVisible();
  await page.getByRole('button', { name: '重新读取' }).click();
  const files = page.getByRole('article', { name: '文件工作台', exact: true });
  await files.getByRole('button', { name: '启用插件' }).click();
  await expect(page.getByRole('alert')).toContainText('保存失败，请重试');
  await expect(files.locator('.plugin-state')).toHaveText('未启用');
  expect(state.selection()).toEqual(emptySelection());
  await expect(page.locator('.plugin-restart')).toHaveCount(0);
});

test('catalog and packs fit desktop, mobile and night theme', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await setup(page);
  await expect(page.getByRole('article')).toHaveCount(PLUGINS.length);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'artifacts/plugins-catalog-desktop.png', animations: 'disabled' });
  await view(page, '整合包').click();
  await expect(page.getByRole('article')).toHaveCount(PLUGIN_PACKS.length);
  await page.screenshot({ path: 'artifacts/plugins-packs-desktop.png', animations: 'disabled' });
  await page.getByRole('button', { name: '切换到夜樱主题' }).click();
  await page.screenshot({ path: 'artifacts/plugins-packs-night.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('searchbox').fill('日常使用');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: '选用整合包' }).click();
  await expect(page.locator('.plugin-restart')).toBeVisible();
  await expect(page.getByRole('button', { name: '移除整合包' })).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/plugins-mobile.png', fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '切换到花昼主题' }).click();
  await view(page, '插件目录').click();
  await page.getByRole('searchbox').fill('files');
  await page.getByText('功能与依赖', { exact: false }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('manifest pages are discoverable through navigation and command palette', async ({ page }) => {
  await setup(page, { active: ['command-palette', 'sandbox'] });
  await expect(
    page.getByRole('group', { name: '已启用的扩展' }).getByRole('button', { name: '沙箱工作台' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '打开命令面板' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox').fill('沙箱');
  await expect(dialog.getByText('沙箱工作台', { exact: true })).toBeVisible();
});
