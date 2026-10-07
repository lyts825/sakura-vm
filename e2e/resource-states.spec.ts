/**
 * 回归范围（完整情景见下方用例与断言）：
 * - task center distinguishes queued, cancelling, retained cleanup and interrupted work on mobile
 */
import { expect, test } from '@playwright/test';
import { emptySelection, PLUGINS, PLUGIN_PACKS } from '../shared/plugins.ts';

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
