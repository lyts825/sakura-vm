/**
 * 模块职责：浏览器回归模块，围绕 `plugin-center` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Browser regression for `plugin-center`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: plugin catalog searches, combines filters, and keeps the base configuration empty; community catalog requires a trusted publisher before installation and can run then unload.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  PLUGINS,
  PLUGIN_PACKS,
  emptySelection,
  type PluginSelection,
  type PluginStatus,
} from '../shared/plugins.ts';
import { explainPlugins, resolvePlugins } from '../shared/plugin-selection.ts';
import { randomUUID } from 'node:crypto';

/**
 * 中文功能：为插件中心安装可写的受控 API 路由，模拟用户选择、实际激活状态和社区目录，再打开对应页面。
 * English: Install writable controlled API routes for plugin selection, actual activation and community metadata, then open the plugin-center page.
 * 输入 / Inputs: page: Page; options: { selection?: PluginSelection; active?: string[]; errors?: Plugin… = {}。
 * 结果：返回受控对象，公开字段包括 `selection, writes`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `selection, writes`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `emptySelection`, `page.route`, `page.goto`, `page.getByRole('button', { name: '插件中心', exact: true }).click`.
 * 设计思路：用户选择与实际激活状态分开保存，浏览器用例可验证“保存后需重启”的差异；写入计数只观察路由请求，避免依赖后台服务或真实插件激活。
 * Design: Store desired selection separately from actual activation so browser tests can verify the restart requirement. Write counters observe routed requests without relying on a controller process or real plugin activation.
 */
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
  const community = {
    publishers: [] as Array<{ fingerprint: string; name: string }>,
    sources: [] as Array<{ id: string; name: string; url: string }>,
    installed: [] as Array<{
      id: string;
      name: string;
      version: string;
      sha256: string;
      publisher: string;
      sourceId: string;
    }>,
    catalogs: {} as Record<string, any[]>,
    subscriptions: [] as Array<{ pluginId: string; types: string[]; enabled: boolean }>,
    schedules: [] as Array<{ pluginId: string; intervalMinutes: number;
      enabled: boolean; nextRunAt: number }>,
    deliveries: [] as Array<{ id: string; pluginId: string; event: { type: string;
      occurredAt: string }; status: string }>,
  };
  await page.route('**/api/**', /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: route。
   * 结果：返回分支计算值（`route.fulfill({ json: { enabled: false, session: { configured: false, enabled: f… / route.fulfill({ status: 503, json: { error: '插件服务暂时不可用' } })`），以 Promise 交付。
   * Result: Return the branch-computed value (`route.fulfill({ json: { enabled: false, session: { configured: false, enabled: f… / route.fulfill({ status: 503, json: { error: '插件服务暂时不可用' } })`) through a Promise.
   * 状态影响 / State effects: `options.readError`, `selection`, `community.catalogs[input.id]`, `community.installed`, `community.subscriptions`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `route.request().url`, `route.request`, `route.fulfill`, `route.request().method`.
   */
  async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/access/status')
      return route.fulfill({
        json: {
          enabled: false,
          session: {
            configured: false,
            enabled: false,
            locked: false,
            idleMinutes: 15,
            retryAfterSeconds: 0,
          },
        },
      });
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
    if (path === '/api/community-plugins/extensions/sample-plugin/inspect')
      return route.fulfill({ json: { pluginId: 'sample-plugin', version: '1.0.0',
        result: { echoed: route.request().postDataJSON().text } } });
    if (path === '/api/community-plugins') {
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON();
        if (input.operation === 'trust')
          community.publishers.push({
            fingerprint: 'a'.repeat(64),
            name: input.name,
          });
        if (input.operation === 'add-source')
          community.sources.push({
            id: randomUUID(),
            name: input.name,
            url: input.url,
          });
        if (input.operation === 'refresh')
          community.catalogs[input.id] = [
            {
              id: 'sample-plugin',
              name: '示例插件',
              description: 'JSON 示例',
              version: '1.0.0',
              sha256: 'b'.repeat(64),
              publisher: 'a'.repeat(64),
              extensions: { routes: [{ id: 'inspect', name: 'Inspect' }],
                panels: [{ id: 'sample', title: '示例扩展', description: '安全 JSON 表单',
                  routeId: 'inspect', fields: [{ key: 'text', label: '输入文本',
                    type: 'text', required: true }] }] },
            },
          ];
        if (input.operation === 'install')
          community.installed.push({
            ...community.catalogs[input.sourceId][0],
            sourceId: input.sourceId,
          });
        if (input.operation === 'uninstall')
          community.installed = community.installed.filter((item) => item.id !== input.pluginId);
        if (input.operation === 'subscribe')
          community.subscriptions = [...community.subscriptions.filter((item) =>
            item.pluginId !== input.pluginId), { pluginId: input.pluginId,
              types: input.types, enabled: input.enabled }];
        if (input.operation === 'unsubscribe')
          community.subscriptions = community.subscriptions.filter((item) =>
            item.pluginId !== input.pluginId);
        if (input.operation === 'schedule')
          community.schedules = [...community.schedules.filter((item) =>
            item.pluginId !== input.pluginId), { pluginId: input.pluginId,
              intervalMinutes: input.intervalMinutes, enabled: input.enabled,
              nextRunAt: Date.now() + input.intervalMinutes * 60000 }];
        if (input.operation === 'unschedule')
          community.schedules = community.schedules.filter((item) =>
            item.pluginId !== input.pluginId);
        if (input.operation === 'run')
          return route.fulfill({
            json: {
              pluginId: input.pluginId,
              version: '1.0.0',
              result: { ok: true },
            },
          });
      }
      return route.fulfill({ json: community });
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
  return { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`selection`）。
   * Result: Return the branch-computed value (`selection`).
   */
  selection: () => selection, /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`writes`）。
   * Result: Return the branch-computed value (`writes`).
   */
  writes: () => writes };
}
/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: page: Page; name: string。
 * 结果：返回分支计算值（`page.getByRole('group', { name: '插件浏览方式' }).getByRole('button', { name: new RegE…`）。
 * Result: Return the branch-computed value (`page.getByRole('group', { name: '插件浏览方式' }).getByRole('button', { name: new RegE…`).
 * 协作入口 / Collaborators: `page.getByRole('group', { name: '插件浏览方式' }).getByRole`, `page.getByRole`.
 */
const view = (page: Page, name: string) =>
  page.getByRole('group', { name: '插件浏览方式' }).getByRole('button', { name: new RegExp(name) });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: { page, }。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plugin catalog searches, combines filters, and keeps the base configuration empty
 * 协作入口 / Collaborators: `setup`, `expect(page.getByRole('article')).toHaveCount`, `expect`, `page.getByRole`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('plugin catalog searches, combines filters, and keeps the base configuration empty', async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByRole('article')).toHaveCount(PLUGINS.length);
  const filters = page.getByRole('button', { name: '插件筛选更多选项' });
  await expect(filters).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('按插件状态筛选')).toBeHidden();
  await page.getByRole('searchbox').fill('FILES');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article', { name: '文件工作台', exact: true })).toBeVisible();
  await filters.focus();
  await filters.press('Enter');
  await expect(filters).toHaveAttribute('aria-expanded', 'true');
  await page
    .getByRole('group', { name: '按用途查看' })
    .getByRole('button', { name: '项目开发', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '没有找到匹配的插件' })).toBeVisible();
  await filters.click();
  await expect(page.getByLabel('按插件状态筛选')).toBeHidden();
  await expect(filters).toContainText('项目开发');
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(PLUGINS.length);
  await view(page, '我的配置').click();
  await expect(page.getByRole('heading', { name: '从基础版开始，也很好。' })).toBeVisible();
  await page.getByRole('button', { name: '浏览插件目录' }).click();
  await filters.click();
  await page.getByLabel('按插件状态筛选').selectOption('active');
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: '重置筛选', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(PLUGINS.length);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: { page, }。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: community catalog requires a trusted publisher before installation and can run then unload
 * 协作入口 / Collaborators: `setup`, `page.getByRole`, `market.getByRole('textbox', { name: '名称' }).last().fill`, `market.getByRole('textbox', { name: '名称' }).last`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('community catalog requires a trusted publisher before installation and can run then unload', async ({
  page,
}) => {
  await setup(page);
  const market = page.getByRole('region', { name: '第三方插件市场' });
  await market.getByRole('textbox', { name: '名称' }).last().fill('测试目录');
  await market.getByRole('textbox', { name: 'HTTPS 目录 URL' }).fill('https://plugins.example/catalog.json');
  await market.getByRole('button', { name: '添加目录源' }).click();
  await market.getByRole('button', { name: '刷新目录' }).click();
  await expect(market.getByText('示例插件')).toBeVisible();
  await expect(market.getByRole('button', { name: '安装' })).toBeDisabled();
  await market.getByRole('textbox', { name: '名称' }).first().fill('测试发布者');
  await market.getByRole('textbox', { name: 'Ed25519 公钥（PEM）' }).fill('test-key');
  await market.getByRole('button', { name: '添加信任' }).click();
  await market.getByRole('button', { name: '安装' }).click();
  await expect(market.getByRole('heading', { name: '已安装的隔离插件' })).toBeVisible();
  await market.getByRole('button', { name: '订阅任务与告警' }).click();
  await expect(market.getByRole('button', { name: '暂停自动触发' })).toBeVisible();
  await market.getByRole('button', { name: '暂停自动触发' }).click();
  await expect(market.getByRole('button', { name: '恢复自动触发' })).toBeVisible();
  await market.getByRole('button', { name: '启用定时' }).click();
  await expect(market.getByRole('button', { name: '暂停定时' })).toBeVisible();
  await market.getByRole('button', { name: '暂停定时' }).click();
  await expect(market.getByRole('button', { name: '恢复定时' })).toBeVisible();
  const panel = market.getByRole('region', { name: '示例扩展' });
  await panel.getByRole('textbox', { name: '输入文本' }).fill('hello');
  await panel.getByRole('button', { name: '运行扩展操作' }).click();
  await expect(panel.getByLabel('示例扩展 结果')).toContainText('hello');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await market.getByRole('button', { name: '测试运行' }).click();
  await expect(market.getByLabel('隔离插件运行结果')).toContainText('"ok": true');
  await market.getByRole('button', { name: '卸载' }).click();
  await expect(market.getByText('尚无已安装插件。')).toBeVisible();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: { page, }。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pack selection, independent retention and removal preserve shared dependencies without activating navigation
 * 协作入口 / Collaborators: `setup`, `view(page, '整合包').click`, `view`, `page.getByRole`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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
  await expect(files.getByRole('button', { name: '保留为独立选择' })).toBeHidden();
  await files.getByLabel('文件工作台的更多选项').click();
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: { page }。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: runtime, pending removal and dependency failures remain distinct
 * 协作入口 / Collaborators: `setup`, `emptySelection`, `expect( page.getByRole('article', { name: '资源采样', exact: true }).locator('.…`, `expect`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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
  await expect(page.getByRole('button', { name: '插件筛选更多选项' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: { page }。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed reads can be retried and rejected changes preserve the current selection
 * 协作入口 / Collaborators: `setup`, `expect(page.getByRole('alert')).toContainText`, `expect`, `page.getByRole`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: { page }。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: catalog and packs fit desktop, mobile and night theme
 * 协作入口 / Collaborators: `page.setViewportSize`, `setup`, `expect(page.getByRole('article')).toHaveCount`, `expect`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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
  await page.getByRole('button', { name: '插件筛选更多选项' }).click();
  await expect(page.getByLabel('按插件状态筛选')).toBeVisible();
  await page.getByLabel('文件工作台的更多选项').click();
  await expect(page.getByRole('button', { name: '保留为独立选择' })).toBeVisible();
  await page.screenshot({
    path: 'artifacts/plugins-more-options-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByLabel('文件工作台的更多选项').click();
  await expect(page.getByRole('button', { name: '保留为独立选择' })).toBeHidden();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: { page }。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: manifest pages are discoverable through navigation and command palette
 * 协作入口 / Collaborators: `setup`, `expect( page.getByRole('group', { name: '已启用的扩展' }).getByRole('button', { n…`, `expect`, `page.getByRole('group', { name: '已启用的扩展' }).getByRole`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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
