/**
 * 模块职责：浏览器回归模块，围绕 `resource-states` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Browser regression for `resource-states`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: task center distinguishes queued, cancelling, retained cleanup and interrupted work on mobile.
 */
import { expect, test } from '@playwright/test';
import { emptySelection, PLUGINS, PLUGIN_PACKS } from '../shared/plugins.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: { page }。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: task center distinguishes queued, cancelling, retained cleanup and interrupted work on mobile
 * 协作入口 / Collaborators: `page.setViewportSize`, `page.route`, `page.goto`, `page.getByRole('button', { name: '任务中心', exact: true }).click`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('task center distinguishes queued, cancelling, retained cleanup and interrupted work on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const base = { startedAt: '2026-10-04T00:00:00.000Z', log: '', action: 'verify' };
  const jobs = [
    { ...base, id: 'queued', title: 'queued-example', status: 'running', admission: 'queued',
      resourceWait: { resource: 'io', reason: '等待磁盘额度', since: base.startedAt } },
    { ...base, id: 'cancelling', title: 'cancel-example', status: 'running', admission: 'cancelling' },
    { ...base, id: 'cleanup', title: 'cleanup-example', status: 'error', admission: 'cleanup-pending' },
    { ...base, id: 'interrupted', title: 'restart-example', status: 'interrupted' },
  ];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = path === '/api/access/status' ? { enabled: false, session: { configured: false, enabled: false, locked: false } } :
      path === '/api/bootstrap' ? { token: 'resource-states' } :
      path === '/api/vms' ? [] : path === '/api/jobs' ? { jobs, warnings: [] } :
      path === '/api/events' ? { events: [] } :
      path === '/api/system' ? { plugins: ['commands'], version: 'test', hostname: 'test', platform: 'test',
        hostCpus: 4, hostMemoryMiB: 4096, freeMemoryMiB: 2048, controllerMemoryMiB: 128, imageReady: true } :
      path === '/api/plugins' ? { selection: emptySelection(), active: ['commands'], planned: ['commands'],
        reasons: {}, migrations: [], restartRequired: false, errors: {}, lifecycle: {}, plugins: PLUGINS, packs: PLUGIN_PACKS } : {};
    await route.fulfill({ json });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '任务中心', exact: true }).click();
  const queued = page.locator('details.feature-card').filter({ hasText: 'queued-example' });
  await expect(queued).toContainText('等待资源');
  await expect(queued).toContainText('等待磁盘额度');
  await expect(queued.getByRole('progressbar')).toHaveCount(0);
  await expect(page.locator('summary').filter({ hasText: 'cancel-example' })).toContainText('正在取消');
  const cleanup = page.locator('details.feature-card').filter({ hasText: 'cleanup-example' });
  await cleanup.locator('summary').click();
  await expect(cleanup).toContainText('清理待确认');
  await expect(cleanup.getByRole('button', { name: '重新执行' })).toHaveCount(0);
  const restart = page.locator('details.feature-card').filter({ hasText: 'restart-example' });
  await restart.locator('summary').click();
  await expect(restart).toContainText('待核对');
  await expect(restart).toContainText('请核对结果后再决定是否重新执行');
  await page.getByLabel('任务状态').selectOption('cleanup-pending');
  await expect(page.locator('details.feature-card')).toHaveCount(1);
  await expect(cleanup).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
